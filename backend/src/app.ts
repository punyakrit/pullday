import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { type Caller, type User, findCaller, lockUser, logIn, logOut, signUp } from './auth.ts';
import { type Rarity, cardDetails, packedCatalogue } from './cards.ts';
import * as challenges from './challenges.ts';
import { type Db, pool, transaction } from './db.ts';
import { isTimezone } from './days.ts';
import { grantCards, moveTime, requireTestAccount } from './dev.ts';
import { ApiError } from './errors.ts';
import { type ImageOptions, type Width, imageStore } from './images.ts';
import { resetAccount } from './seed.ts';
import { enableDevOffset, now } from './time.ts';
import { changeTimezone } from './timezone.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Anyone may call it. */
    open?: boolean;
    /** Does not count as this phone having been online. Outbox calls (start, complete, reveal seen), log out, dev tools. */
    quiet?: boolean;
  }
  interface FastifyRequest {
    caller: Caller;
    token: string;
  }
}

const UUID = '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false, // an unknown field, such as a date, is refused and not ignored
});
const optional = (properties: Record<string, unknown>) => ({ ...object(properties, []), type: ['object', 'null'] });
const nothing = { type: ['object', 'null'], additionalProperties: false };
const idParam = object({ id: { type: 'string', pattern: UUID } });
const cardParam = object({ id: { type: 'string', pattern: '^c_[0-9]{4}$' } });
const login = {
  email: { type: 'string', maxLength: 254, pattern: '^\\s*[^\\s@\\u0000-\\u001f]+@[^\\s@\\u0000-\\u001f]+\\.[^\\s@\\u0000-\\u001f]+\\s*$' },
  password: { type: 'string', minLength: 8, maxLength: 200 },
  deviceId: { type: 'string', pattern: UUID },
};

/** One transaction with the user locked, so nothing else of theirs runs at the same time. */
function asUser<T>(request: FastifyRequest, work: (db: Db, user: User) => Promise<T>): Promise<T> {
  return transaction(async (db) => work(db, await lockUser(db, request.caller.userId)));
}

export function buildApp(options: { devTools: boolean; logger?: boolean; images?: Partial<ImageOptions> }): FastifyInstance {
  enableDevOffset(options.devTools);
  const getImage = imageStore(options.images);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const status = error.statusCode ?? 500;
    if (status < 500) return reply.code(status).send({ error: 'bad_request', message: error.message });
    request.log.error(error);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong on our side. Please try again.' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found', message: 'Not found.' }));

  app.addHook('onRequest', async (request) => {
    const { open, quiet } = request.routeOptions.config;
    if (open || request.is404) return;
    const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    const caller = token ? await findCaller(token) : null;
    if (!token || !caller) throw new ApiError(401, 'signed_out', 'Please log in again.');
    request.caller = caller;
    request.token = token;
    // Saved on its own, so it stands even if the request itself is refused.
    if (!quiet) {
      await pool.query('update devices set last_contact_at = $3 where user_id = $1 and device_id = $2', [
        caller.userId,
        caller.deviceId,
        now(caller),
      ]);
    }
  });

  app.get('/health', { config: { open: true } }, async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  // Accounts

  app.post<{ Body: { email: string; password: string; timezone: string; deviceId: string } }>(
    '/auth/signup',
    { config: { open: true }, schema: { body: object({ ...login, timezone: { type: 'string', maxLength: 64 } }) } },
    async (request, reply) => reply.code(201).send(await signUp(request.body)),
  );
  app.post<{ Body: { email: string; password: string; deviceId: string } }>(
    '/auth/login',
    { config: { open: true }, schema: { body: object(login) } },
    async (request) => logIn(request.body),
  );
  app.post('/auth/logout', { config: { quiet: true }, schema: { body: nothing } }, async (request, reply) => {
    await logOut(request.token);
    return reply.code(204).send();
  });

  app.put<{ Body: { timezone: string } }>(
    '/me/timezone',
    { schema: { body: object({ timezone: { type: 'string', maxLength: 64 } }) } },
    async (request) => asUser(request, (db, user) => changeTimezone(db, user, request.body.timezone)),
  );

  // The daily loop

  app.get('/today', async (request) =>
    asUser(request, (db, user) => challenges.getToday(db, user, request.caller.deviceId)),
  );
  app.post<{ Params: { id: string } }>(
    '/challenges/:id/start',
    { config: { quiet: true }, schema: { params: idParam, body: nothing } }, // queued offline, so it can arrive late
    async (request) => asUser(request, (db, user) => challenges.start(db, user, request.params.id)),
  );
  app.post<{ Params: { id: string }; Body: { answers: Rarity[] } }>(
    '/challenges/:id/complete',
    {
      config: { quiet: true },
      schema: {
        params: idParam,
        body: object({
          answers: { type: 'array', minItems: 8, maxItems: 8, items: { enum: ['common', 'rare', 'holo'] } },
        }),
      },
    },
    async (request) =>
      asUser(request, (db, user) =>
        challenges.complete(db, user, request.caller.deviceId, request.params.id, request.body.answers),
      ),
  );
  app.post<{ Params: { id: string } }>(
    '/challenges/:id/reveal-seen',
    { config: { quiet: true }, schema: { params: idParam, body: nothing } },
    async (request) => asUser(request, (db, user) => challenges.revealSeen(db, user, request.params.id)),
  );

  // Cards

  app.get('/collection', async (request) => asUser(request, (db, user) => challenges.getCollection(db, user.id)));
  app.get('/catalogue', async (request, reply) => {
    const { etag, json, gzip } = await packedCatalogue();
    reply.header('etag', etag).header('cache-control', 'private, no-cache').header('vary', 'accept-encoding');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    if (!/\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) return reply.send(json);
    return reply.header('content-encoding', 'gzip').send(gzip);
  });
  app.get<{ Params: { id: string } }>(
    '/cards/:id',
    { schema: { params: cardParam } },
    async (request) => cardDetails(request.params.id, request.caller.userId),
  );
  // Open, so the phone's image cache can fetch it as a plain URL.
  app.get<{ Params: { id: string }; Querystring: { w?: string; grey?: string } }>(
    '/images/:id',
    {
      config: { open: true },
      schema: {
        params: cardParam,
        querystring: object({ w: { enum: ['200', '400', '1080'] }, grey: { enum: ['0', '1'] } }, []),
      },
    },
    async (request, reply) => {
      const { w = '400', grey } = request.query;
      try {
        const image = await getImage(request.params.id, Number(w) as Width, grey === '1');
        return reply.type('image/webp').header('cache-control', 'public, max-age=31536000, immutable').send(image);
      } catch (err) {
        const missing = err instanceof ApiError && err.status === 404;
        reply.header('cache-control', missing ? 'public, max-age=3600' : 'no-store');
        throw err;
      }
    },
  );

  // Dev tools. Without DEV_TOOLS=1 these routes do not exist. They are quiet, so moving time
  // does not spoil an offline test.

  if (options.devTools) {
    const config = { quiet: true };
    app.post<{ Body: { minutes: number } }>(
      '/dev/move-time',
      { config, schema: { body: object({ minutes: { type: 'integer', minimum: 1, maximum: 60 * 24 * 365 } }) } },
      async (request) =>
        asUser(request, (db, user) => {
          requireTestAccount(user);
          return moveTime(db, user, request.body.minutes);
        }),
    );
    app.post<{ Body: { cardId?: string; count?: number } | null }>(
      '/dev/grant-card',
      {
        config,
        schema: {
          body: optional({
            cardId: { type: 'string', pattern: '^c_[0-9]{4}$' },
            count: { type: 'integer', minimum: 1, maximum: 2000 },
          }),
        },
      },
      async (request) =>
        asUser(request, (db, user) => {
          requireTestAccount(user);
          return grantCards(db, user, request.body ?? {});
        }),
    );
    app.post<{ Body: { timezone?: string } | null }>(
      '/dev/reset',
      { config, schema: { body: optional({ timezone: { type: 'string', maxLength: 64 } }) } },
      async (request) => {
        const timezone = request.body?.timezone;
        if (timezone && !isTimezone(timezone)) throw new ApiError(400, 'bad_timezone', 'That time zone is not one we know.');
        requireTestAccount(request.caller);
        await resetAccount(request.caller.email, timezone);
        return { reset: request.caller.email };
      },
    );
  }

  return app;
}
