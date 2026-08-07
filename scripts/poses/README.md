# Card/OG pose scripts

Scenes that need to be *doing something* before they photograph well — a ball
mid-strike, a half-typed test — are posed by these snippets, fed to
`gen-card.cjs --eval`.

They live here rather than in a scratch directory on purpose: a card is not
reproducible if the only thing that could recreate it was a throwaway file on
one machine. Each script documents its own regeneration command at the bottom.

They drive the page through **real input only** (pointer events, clicks, the
toy's own DOM) — never a debug hook, because debug hooks must not ship.
