# Testy w tym repo

To repo używa `pnpm` (workspace + turbo), nie `npx`.

## Wymagania

- Node.js `>=20`
- `pnpm` `>=10.28.2`
- zależności zainstalowane w katalogu repo: `pnpm install`

## Najczęstsze komendy (odpalane z roota repo)

```bash
pnpm test              # pełny zestaw testów skonfigurowany przez turbo
pnpm test:unit         # szybkie testy jednostkowe
pnpm test:services     # testy warstwy services
pnpm test:routes       # testy routes
pnpm test:security     # testy security
pnpm test:integration  # testy integracyjne (wymaga DB/Redis)
pnpm test:coverage     # testy z coverage
pnpm test:watch        # watch mode
```

## Testy integracyjne (DB/Redis)

Przed `pnpm test:integration` uruchom zależności testowe:

```bash
docker compose -f docker/docker-compose.test.yml up -d --wait
pnpm test:integration
docker compose -f docker/docker-compose.test.yml down --volumes
```

## Uruchamianie testów dla konkretnej appki

```bash
pnpm --filter @tracearr/server test
pnpm --filter @tracearr/web test
```

(`apps/mobile` nie ma aktualnie skryptu `test` w `package.json`.)

## Działające obejście w tym środowisku (bez globalnego pnpm, 2026-05-06)

Na tej maszynie domyślnie jest Node 18 i brak globalnego `pnpm`, ale testy da się uruchomić przez `npx` z Node 20:

```bash
npx --yes -p node@20 -p pnpm pnpm test:unit
```

To zostało zweryfikowane: komenda zakończyła się `exit code 0` (server unit tests przeszły: `33` pliki, `1234` testy).

Dodatkowo pomocniczo:

```bash
npx --yes -p node@20 -p pnpm pnpm node -v
```

powinno pokazać `v20.x`, czyli właściwy runtime dla tego repo.
