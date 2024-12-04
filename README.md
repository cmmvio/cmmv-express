<p align="center">
  <a href="https://cmmv.io/" target="blank"><img src="https://raw.githubusercontent.com/andrehrferreira/docs.cmmv.io/main/public/assets/logo_CMMV2_icon.png" width="300" alt="CMMV Logo" /></a>
</p>
<p align="center">Contract-Model-Model-View (CMMV) <br/> Building scalable and modular applications using contracts.</p>
<p align="center">
    <a href="https://www.npmjs.com/package/@cmmv/express"><img src="https://img.shields.io/npm/v/@cmmv/express.svg" alt="NPM Version" /></a>
    <a href="https://github.com/andrehrferreira/cmmv-express/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@cmmv/express.svg" alt="Package License" /></a>
</p>

<p align="center">
  <a href="https://cmmv.io">Documentation</a> &bull;
  <a href="https://github.com/andrehrferreira/cmmv/issues">Report Issue</a>
</p>

## Description

CMMV (Contract-Model-Model-View) is a minimalistic and modular framework for building scalable applications in TypeScript. Inspired by modern design patterns, CMMV uses contracts to define the entire application, from ORM entities to REST controllers and WebSocket endpoints, allowing for a highly structured and maintainable codebase.

## Legacy Setup (Manual)

If you prefer to set up the project manually, you can still install the necessary modules individually:

```bash
$ pnpm add @cmmv/express express body-parser cors express-session helmet uuid
```

## Quick Start

The `@cmmv/express` module provides an alternative HTTP adapter based on [Express](https://expressjs.com/), allowing you to use Express middleware and features seamlessly with your CMMV application.

```typescript
import { Application } from "@cmmv/core";
import { ExpressAdapter, ExpressModule } from "@cmmv/express";
import { ViewModule } from "@cmmv/view";

Application.create({
    httpAdapter: ExpressAdapter, // Add the ExpressAdapter here
    wsAdapter: WSAdapter,
    modules: [
        ExpressModule, // Add the ExpressModule here
    ],
    services: [...],
    contracts: [...]
});
```