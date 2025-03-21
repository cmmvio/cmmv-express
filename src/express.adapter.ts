import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { Duplex } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';

import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as session from 'express-session';
import helmet from 'helmet';

const compression = require('compression');

import {
    AbstractHttpAdapter,
    IHTTPSettings,
    Logger,
    Application,
    Telemetry,
    Config,
    ServiceRegistry,
} from '@cmmv/core';

import { ControllerRegistry } from '@cmmv/http';

export interface ExpressRequest extends express.Request {
    requestId?: string;
}

export class ExpressAdapter extends AbstractHttpAdapter<
    http.Server | https.Server
> {
    protected readonly openConnections = new Set<Duplex>();

    constructor(protected instance?: any) {
        super(instance || express());
    }

    public async init(application: Application, settings?: IHTTPSettings) {
        let publicDirs = Config.get<string[]>('server.publicDirs', [
            'public/views',
        ]);

        const renderEngine = Config.get<string>('server.render', 'cmmv');

        if (publicDirs.length > 0)
            publicDirs = publicDirs.map(dir => path.join(process.cwd(), dir));

        this.application = application;

        this.instance = this.instance || express();

        if (!Config.get<boolean>('server.poweredBy', false))
            this.instance.disable('x-powered-by');

        if (Config.get<boolean>('server.compress.enabled', true))
            this.instance.use(compression({ level: 6 }));

        if (renderEngine === '@cmmv/view' || renderEngine === 'cmmv') {
            for (const publicDir of publicDirs) {
                this.instance.use(
                    express.static(publicDir, {
                        setHeaders: (res, path) => {
                            if (path.endsWith('.html')) {
                                res.setHeader('Cache-Control', 'no-cache');
                            } else {
                                res.setHeader(
                                    'Cache-Control',
                                    'public, max-age=31536000, immutable',
                                );
                            }
                        },
                    }),
                );
            }

            const { CMMVRenderer } = await import('@cmmv/view');
            const render = new CMMVRenderer();

            this.instance.set('views', publicDirs);
            this.instance.set('view engine', 'html');
            this.instance.engine('html', (filePath, options, callback) => {
                render.renderFile(
                    filePath,
                    options,
                    { nonce: options.nonce || '' },
                    callback,
                );
            });
        } else if (renderEngine) {
            this.instance.set('views', publicDirs);
            this.instance.set('view engine', renderEngine);
        }

        this.instance.use(express.json());
        this.instance.use(bodyParser.json({ limit: '50mb' }));
        this.instance.use(
            bodyParser.urlencoded({
                limit: '50mb',
                extended: true,
            }),
        );

        if (Config.get<boolean>('server.cors', true)) {
            this.instance.use(
                cors({
                    methods: ['GET', 'POST', 'PUT', 'DELETE'],
                    allowedHeaders: ['Content-Type', 'Authorization'],
                }),
            );
        }

        if (Config.get<boolean>('server.helmet.enabled', true)) {
            this.instance.use(
                helmet(
                    Config.get('server.helmet.options', {
                        contentSecurityPolicy: false,
                    }),
                ),
            );
        }

        if (Config.get<boolean>('server.session.enabled', false)) {
            this.instance.use(
                session(
                    Config.get('server.session.options', {
                        secret: process.env.SESSION_SECRET,
                        resave: false,
                        saveUninitialized: false,
                        cookie: { secure: true },
                    }),
                ),
            );
        }

        this.setMiddleware();
        this.registerControllers();
        this.initHttpServer(settings);
    }

    public initHttpServer(options: any) {
        const isHttpsEnabled = options && options.httpsOptions;

        if (isHttpsEnabled) {
            this.httpServer = https.createServer(
                options.httpsOptions,
                this.instance,
            );
        } else {
            this.httpServer = http.createServer(this.instance);
        }

        if (!this.httpServer) throw new Error('Unable to start HTTP adapter');

        this.trackOpenConnections();
    }

    private trackOpenConnections() {
        this.httpServer.on('connection', (socket: Duplex) => {
            this.openConnections.add(socket);
            socket.on('close', () => this.openConnections.delete(socket));
        });
    }

    private closeOpenConnections() {
        for (const socket of this.openConnections) {
            socket.destroy();
            this.openConnections.delete(socket);
        }
    }

    private setMiddleware() {
        this.instance.use((req, res, next) => {
            req.requestId = uuidv4();

            res.locals.nonce = uuidv4().substring(0, 8);
            const customHeaders = Config.get('headers') || {};

            for (const headerName in customHeaders) {
                let headerValue = customHeaders[headerName];

                if (Array.isArray(headerValue)) {
                    headerValue = headerValue
                        .map(value => {
                            if (headerName === 'Content-Security-Policy')
                                return value.indexOf('style-src') == -1
                                    ? `${value} 'nonce-${res.locals.nonce}'`
                                    : value;

                            return value;
                        })
                        .join('; ');
                } else if (typeof headerValue === 'string') {
                    if (headerName === 'Content-Security-Policy')
                        headerValue =
                            headerValue.indexOf('style-src') == -1
                                ? `${headerValue} 'nonce-${res.locals.nonce}'`
                                : headerValue;
                }

                res.setHeader(headerName, headerValue);
            }

            if (req.method === 'GET') {
                if (!Config.get<boolean>('server.removePolicyHeaders', false)) {
                    res.setHeader(
                        'Strict-Transport-Security',
                        'max-age=15552000; includeSubDomains',
                    );
                    res.setHeader('X-Content-Type-Options', 'nosniff');
                    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                    res.setHeader('X-XSS-Protection', '0');
                }
            }

            if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
                if (!Config.get<boolean>('server.removePolicyHeaders', false)) {
                    res.removeHeader('X-DNS-Prefetch-Control');
                    res.removeHeader('X-Download-Options');
                    res.removeHeader('X-Permitted-Cross-Domain-Policies');
                    res.removeHeader('Strict-Transport-Security');
                    res.removeHeader('Content-Security-Policy');
                    res.removeHeader('Cross-Origin-Opener-Policy');
                    res.removeHeader('Cross-Origin-Resource-Policy');
                    res.removeHeader('Origin-Agent-Cluster');
                    res.removeHeader('Referrer-Policy');
                }
            }

            next();
        });

        this.instance.use((req, res, next) => {
            Telemetry.start('Request Process', req.requestId);
            const publicDir = path.join(process.cwd(), 'public/views');
            const requestPath =
                req.path === '/' ? 'index' : req.path.substring(1);
            const ext = path.extname(req.path);

            if (req.path.indexOf('.html') === -1 && req.path !== '/')
                return next();

            const possiblePaths = [
                path.join(publicDir, `${requestPath}.html`),
                path.join(publicDir, requestPath, 'index.html'),
                path.join(publicDir, `${requestPath}`),
                path.join(publicDir, requestPath, 'index.html'),
            ];

            let fileFound = false;

            for (const filePath of possiblePaths) {
                if (fs.existsSync(filePath)) {
                    fileFound = true;

                    const config = Config.getAll();

                    return res.render(filePath, {
                        nonce: res.locals.nonce,
                        services: ServiceRegistry.getServicesArr(),
                        requestId: req.requestId,
                        config,
                    });
                }
            }

            if (!fileFound) res.status(404).send('Page not found');
        });
    }

    private registerControllers() {
        const controllers = ControllerRegistry.getControllers();

        controllers.forEach(([controllerClass, metadata]) => {
            const paramTypes =
                Reflect.getMetadata('design:paramtypes', controllerClass) || [];
            const instances = paramTypes.map((paramType: any) =>
                this.application.providersMap.get(paramType.name),
            );

            const instance = new controllerClass(...instances);
            const prefix = metadata.prefix;
            const routes = metadata.routes;

            routes.forEach(route => {
                const fullPath = `/${prefix}${route.path ? '/' + route.path : ''}`;
                const method = route.method.toLowerCase();

                if (this.instance[method]) {
                    const handler = async (
                        req: ExpressRequest | any,
                        res: express.Response,
                        next: any,
                    ) => {
                        const startTime = Date.now();

                        try {
                            req.contextId = crypto
                                .createHash('md5')
                                .update(`${req.method}::${req.route.path}`)
                                .digest('hex');

                            if (
                                Application.appModule.httpInterceptors.length >
                                0
                            ) {
                                for (const interceptor of Application.appModule
                                    .httpInterceptors) {
                                    const breakProcess = await interceptor(
                                        `${req.method}::${req.route.path}`.toLocaleLowerCase(),
                                        {
                                            req,
                                            res,
                                            next,
                                            handler:
                                                instance[route.handlerName],
                                        },
                                    );

                                    if (breakProcess) return;
                                }
                            }

                            const args = this.buildRouteArgs(
                                req,
                                res,
                                next,
                                route.params,
                            );

                            Telemetry.start(
                                'Controller Handler',
                                req.requestId,
                            );

                            const result = await instance[route.handlerName](
                                ...args,
                            );

                            Telemetry.end('Controller Handler', req.requestId);

                            const processingTime = Date.now() - startTime;
                            Telemetry.end('Request Process', req.requestId);
                            const telemetry = Telemetry.getTelemetry(
                                req.requestId,
                            );

                            if (this.isJson(result)) {
                                const response = {
                                    status: 200,
                                    processingTime,
                                    data: result,
                                };

                                if (req.query.debug) {
                                    response['requestId'] = req.requestId;
                                    response['telemetry'] = telemetry;
                                }

                                if (
                                    Application.appModule.httpAfterRender
                                        .length > 0
                                ) {
                                    for (const afterRender of Application
                                        .appModule.httpAfterRender) {
                                        await afterRender(
                                            `${req.method}::${req.route.path}`.toLocaleLowerCase(),
                                            {
                                                req,
                                                res,
                                                next,
                                                handler:
                                                    instance[route.handlerName],
                                                content: response,
                                            },
                                        );
                                    }
                                }

                                res.json(response);
                            } else if (result) {
                                if (
                                    Application.appModule.httpAfterRender
                                        .length > 0
                                ) {
                                    for (const afterRender of Application
                                        .appModule.httpAfterRender) {
                                        await afterRender(
                                            `${req.method}::${req.route.path}`.toLocaleLowerCase(),
                                            {
                                                req,
                                                res,
                                                next,
                                                handler:
                                                    instance[route.handlerName],
                                                content: result,
                                            },
                                        );
                                    }
                                }

                                res.status(200).send(result);
                            }
                        } catch (error) {
                            console.error(error);
                            const processingTime = Date.now() - startTime;
                            Telemetry.end('Request Process', req.requestId);
                            const telemetry = Telemetry.getTelemetry(
                                req.requestId,
                            );

                            const response = {
                                status: 500,
                                processingTime,
                                message:
                                    error.message || 'Internal Server Error',
                            };

                            if (req.query.debug) {
                                response['requestId'] = req.requestId;
                                response['telemetry'] = telemetry;
                            }

                            res.status(500).json(response);
                        }

                        Telemetry.clearTelemetry(req.requestId);
                    };

                    if (route.middlewares) {
                        this.instance[method](
                            fullPath,
                            async (req, res, next) => {
                                try {
                                    if (
                                        Array.isArray(route.middlewares) &&
                                        route.middlewares.length > 0
                                    ) {
                                        for (const middleware of route.middlewares) {
                                            await new Promise(
                                                (resolve, reject) => {
                                                    middleware(
                                                        req,
                                                        res,
                                                        err => {
                                                            if (err)
                                                                return reject(
                                                                    err,
                                                                );
                                                            resolve(null);
                                                        },
                                                    );
                                                },
                                            );
                                        }
                                    }

                                    await handler(req, res, next);
                                } catch (error) {
                                    console.error(
                                        'Error processing middlewares or handler:',
                                        error,
                                    );
                                    next(error);
                                }
                            },
                        );
                    } else {
                        this.instance[method](fullPath, handler);
                    }
                }
            });
        });
    }

    private buildRouteArgs(
        req: express.Request | any,
        res: express.Response,
        next: any,
        params: any[],
    ) {
        const args: any[] = [];

        params?.forEach(param => {
            const [paramType, paramName] = param.paramType.split(':');
            switch (paramType) {
                case 'body':
                    args[param.index] = req.body;
                    break;
                case 'param':
                    args[param.index] = req.params[paramName];
                    break;
                case 'query':
                    args[param.index] = req.query[paramName];
                    break;
                case 'queries':
                    args[param.index] = req.query;
                    break;
                case 'header':
                    args[param.index] = req.headers[paramName.toLowerCase()];
                    break;
                case 'headers':
                    args[param.index] = req.headers;
                    break;
                case 'request':
                    args[param.index] = req;
                    break;
                case 'response':
                    args[param.index] = res;
                    break;
                case 'next':
                    args[param.index] = next;
                    break;
                case 'session':
                    args[param.index] = req.session;
                    break;
                case 'user':
                    args[param.index] = req.user;
                    break;
                case 'ip':
                    args[param.index] = req.ip;
                    break;
                case 'hosts':
                    args[param.index] = req.hosts;
                    break;
                default:
                    args[param.index] = undefined;
                    break;
            }
        });

        return args;
    }

    public listen(bind: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const [host, port] = bind.split(':');

            this.httpServer.listen(parseInt(port, 10), host, (err?: any) => {
                if (err) return reject(err);

                resolve();
            });
        });
    }

    public connected() {
        return this.instance.enabled;
    }

    public close() {
        this.closeOpenConnections();

        if (!this.httpServer) return undefined;

        return new Promise((resolve, reject) => {
            if (this.connected()) {
                try {
                    this.httpServer.close(err => {
                        if (err) reject(err);
                        else resolve('');
                    });
                } catch (err) {
                    reject(err);
                }
            } else {
                resolve('');
            }
        });
    }
}
