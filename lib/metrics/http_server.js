'use strict';

const { Summary, Histogram, Gauge, Counter } = require('prom-client');

function getRequestContentLength(req) {
  let reqContentLength = 0;
  if ('content-length' in req.headers) {
    reqContentLength = parseInt(req.headers['content-length'], 10);
  }
  return reqContentLength;
}

function getResponseContentLength(req, res) {
  // Try to get header
  const hcl = res.getHeader('content-length');
  if (hcl !== undefined && hcl && !isNaN(hcl)) {
    return parseInt(hcl);
  }

  // If this does not work, calculate using bytesWritten
  // taking into account res._header
  const initial = 0;
  let written = req.socket.bytesWritten - initial;
  if ('_header' in res) {
    try {
      const hbuf = Buffer.from(res._header);
      const hslen = hbuf.length;
      written -= hslen;
    } catch (e) {
      console.error('[getResponseContentLength error] res._header:', res._header);
      console.info('[getResponseContentLength error]', req.url);
    }
  }
  return written;
}

module.exports = app => {
  const { prefix } = app.config.exporter;
  const requestDuration = new Histogram({
    name: `${prefix}http_request_duration_milliseconds`,
    help: 'Http requests duration',
    labelNames: ['method', 'status'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  });
  const requestSize = new Summary({
    name: `${prefix}http_request_size_bytes`,
    help: 'Http requests size',
    labelNames: ['method', 'status'],
  });
  const responseSize = new Summary({
    name: `${prefix}http_response_size_bytes`,
    help: 'Http requests size',
    labelNames: ['method', 'status'],
  });
  const requestTotal = new Counter({
    name: `${prefix}http_request_total`,
    help: 'number of requests to a route',
    labelNames: ['method', 'path', 'status'],
  });
  const requestErrTotal = new Counter({
    name: `${prefix}http_all_errors_total`,
    help: 'The total number of all API requests with error response',
    labelNames: ['method', 'path', 'status'],
  });
  const requestInProcessing = new Gauge({
    name: `${prefix}http_all_request_in_processing_total`,
    help: 'The total number of all API requests currently in processing (no response yet)',
  });

  app.on('error', (err, ctx) => {
    const { method, path } = ctx || {};
    requestErrTotal.inc({ method, path, status: 500 }, 1);
  });

  app.on('request', ctx => {
    const { method, status, path } = ctx;
    requestTotal.inc({ method, path, status }, 1);
    requestInProcessing.inc();
  });

  app.on('response', ctx => {
    const { method, status, req, res } = ctx;
    if (status >= 200 && status < 400) {
      requestDuration.observe({ method, status }, Date.now() - ctx.starttime);
    }
    try {
      requestSize.observe({ method, status }, getRequestContentLength(req, res));
      responseSize.observe({ method, status }, getResponseContentLength(req, res));
    } catch(e) {
      console.error('[getResponseContentLength error]', method, status, req.url);
      throw e
    }
    console.info('[getResponseContentLength error]', method, status, req.url);
    requestInProcessing.dec();
  });
};
