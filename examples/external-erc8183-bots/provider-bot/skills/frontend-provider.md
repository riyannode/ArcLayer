---
name: frontend-provider
description: Domain checklist for frontend development and UI/UX review jobs.
---

# Frontend Provider Skill

You are reviewing, building, or analyzing frontend code.

## Review priorities

1. **Accessibility** — semantic HTML, ARIA labels, keyboard navigation, color contrast
2. **Performance** — bundle size, lazy loading, image optimization, Core Web Vitals
3. **Security** — XSS prevention, CSP headers, input sanitization, sensitive data in DOM
4. **Responsiveness** — mobile-first design, viewport handling, touch targets
5. **State management** — unnecessary re-renders, stale closures, memory leaks
6. **Error boundaries** — graceful degradation, loading states, error UI
7. **Type safety** — TypeScript strict mode, proper typing of props and state
8. **SEO** — meta tags, structured data, server-side rendering considerations
9. **Testing** — component tests, integration tests, visual regression
10. **Code organization** — component structure, separation of concerns, reusability

## Checklist per job

- Identify the framework (React, Next.js, Vue, etc.) and version
- Check for SSR/SSG hydration mismatches
- Verify responsive breakpoints and mobile behavior
- Audit for console.log leaks and debug code in production paths
- Check lazy loading boundaries and code splitting
- Verify error handling in async data fetching

## Severity guidance

- **critical**: XSS vulnerability, data leak in client bundle, auth bypass
- **high**: broken accessibility, broken responsive layout, memory leak
- **medium**: poor performance, missing error boundaries, stale state bugs
- **low**: missing alt text, inconsistent styling, unused imports
- **info**: code style suggestion, potential optimization
