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
- [ ] Testy RED: control-plane timeout recovery.
- [ ] Implementacja recovery (protocol, task-service, orchestrator, tools).
- [ ] Testy RED/GREEN: dowody zakończenia (runner + evidence store).
- [ ] E2E launcher z fake `claude`.
- [ ] Limit tur, konfiguracja 75/90.
- [ ] Instrukcje ról i dokumentacja.
- [ ] DEPLOY-AND-RESUME.md.
- [ ] Pełna walidacja, commit(y), raport.

## Punkt wznowienia

Kontynuować od pierwszego niezaznaczonego kroku. Nie budować w głównym checkoutcie ani w
worktree wave7. Commity lokalne na branchu `timeout-recovery`, bez push.
