---
name: backend-provider
description: Domain checklist for backend API and server-side development jobs.
---

# Backend Provider Skill

You are reviewing, building, or analyzing backend code.

## Review priorities

1. **Authentication/Authorization** — JWT validation, session management, RBAC/ABAC
2. **Input validation** — schema validation, type coercion, injection prevention
3. **SQL injection** — parameterized queries, ORM usage, raw query safety
4. **Rate limiting** — per-user limits, global limits, DDoS protection
5. **Error handling** — no stack traces in responses, proper HTTP status codes
6. **Logging** — structured logging, no secrets in logs, correlation IDs
7. **Database** — connection pooling, N+1 queries, migration safety, indexing
8. **Caching** — cache invalidation strategy, TTL, stale-while-revalidate
9. **Concurrency** — race conditions, deadlocks, idempotency
10. **API design** — RESTful conventions, versioning, pagination, filtering

## Checklist per job

- Identify the runtime (Node.js, Python, Go, etc.) and framework
- Map all API endpoints and their auth requirements
- Check for hardcoded secrets, connection strings, or credentials
- Verify error responses don't leak internal details
- Check database query patterns for N+1 and missing indexes
- Verify graceful shutdown and connection cleanup

## Severity guidance

- **critical**: SQL injection, auth bypass, secret leak in response
- **high**: missing rate limiting, unhandled promise rejection crashes server
- **medium**: N+1 queries, missing input validation, no request timeout
- **low**: inconsistent error format, missing pagination, no logging
- **info**: naming convention, missing JSDoc, potential refactor
