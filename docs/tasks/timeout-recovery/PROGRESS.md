# PROGRESS — timeout recovery

Status: W TOKU. Plan: [PLAN.md](PLAN.md), AC: [ACCEPTANCE.md](ACCEPTANCE.md).

- Branch `timeout-recovery`, worktree `<local-workspace>/bridge-timeout-recovery`,
  baza `aeb92c2`. Aktywny runtime: główny checkout (`node scripts/native-bridge-mcp.mjs`,
  Codex manager) oraz worktree wave7 (`.bridge/bridge.db` featura) — nie ruszać.
- Baseline w worktree: `npm ci --ignore-scripts`, `npm run build`, `npm test` → 342/342.

## Kroki

- [x] Analiza kodu i przyczyny (PLAN, sekcja „Przyczyna błędu”).
- [x] Weryfikacja klientów w źródłach (Codex 0.154.0 sparse clone w scratchpadzie, TS SDK,
      binarka Claude Code 2.1.269).
- [x] Plan, AC, PROGRESS.
- [x] Testy RED: control-plane timeout recovery (`timeout-recovery.test.ts`, 19 RED z
      `not recoverable from FAILED`).
- [x] Implementacja recovery (protocol, task-service, orchestrator, tools) → GREEN.
- [x] Testy RED/GREEN: dowody zakończenia (`evidence.test.ts`,
      `claude-code-runner.evidence.test.ts`, `evidence-store.ts`, callback w runnerze,
      `DEADLINE_ABORT_REASON`).
- [x] E2E launcher z fake `claude` na PATH (`native-launcher.test.ts`).
- [x] Limit tur 64 → 256 (test RED `expected 64 to be 256` → GREEN).
- [ ] Konfiguracja 75/90 (`.codex/config.toml`, `.mcp.json`, przykład Claude’a).
- [ ] Instrukcje ról i dokumentacja.
- [ ] DEPLOY-AND-RESUME.md.
- [ ] Pełna walidacja, commit(y), raport.

## Punkt wznowienia

Kontynuować od pierwszego niezaznaczonego kroku. Nie budować w głównym checkoutcie ani w
worktree wave7. Commity lokalne na branchu `timeout-recovery`, bez push.
