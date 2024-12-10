import { Module } from '@cmmv/core';

import { ExpressTranspiler } from './express.transpiler';

export const ExpressModule = new Module('express', {
    transpilers: [ExpressTranspiler],
});
