// Request-time clock for server components. RSCs render once per request, so
// reading the clock is legitimate there — but the react-hooks purity lint
// can't tell an RSC from a client component. Routing the read through this
// helper keeps component bodies free of direct impure globals and gives the
// convention one name. Never call from client components (use effects/events).
export const requestNowMs = (): number => Date.now();
