# PROGRESS — timeout recovery

Status: IMPLEMENTACJA DOSTARCZONA; integracja wave9 GOTOWA DO REVIEW. Plan: [PLAN.md](PLAN.md), AC: [ACCEPTANCE.md](ACCEPTANCE.md).

- Branch `timeout-recovery`, osobny worktree tego brancha
  (`<local-workspace>/bridge-timeout-recovery`), baza `aeb92c2`. Aktywny runtime: główny
  checkout (`node scripts/native-bridge-mcp.mjs`, Codex manager) oraz worktree wave7
  (`.bridge/bridge.db` featura) — nie ruszać.
- Baseline w worktree: `npm ci --ignore-scripts`, `npm run build`, `npm test` → 342/342.

## Aktualizacja wave9

Zapisy poniżej opisują historyczny zakres wykonawcy timeout-recovery. Późniejsze review,
lokalne wdrożenie przypiętego runtime i zgłoszone recovery rozlicza
[postęp wave9](../../plans/wave9-progress.md). Dawne wskazanie głównego checkoutu jako runtime
nie jest aktualną instrukcją: aktywny wave7 używa osobnego przypiętego buildu.

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
- [x] Konfiguracja 75/90 (`.codex/config.toml` 5400 s, `.mcp.json` i przykłady 5 400 000 ms,
      przykład Codex dla projektów zewnętrznych).
- [x] Instrukcje ról i dokumentacja (bridge-loop, feature-execute, using-bridge w obu
      identycznych kopiach, recovery/feature-workflow/PROTOCOL/troubleshooting/fork-setup/README).
- [x] [DEPLOY-AND-RESUME.md](DEPLOY-AND-RESUME.md) — gotowa do review, niewykonana.
- [x] Poprawki procedury po review: dostarczenie instrukcji do worktree wave7 (nowy runtime
      nie zmienia tamtejszych skilli), rozdzielenie kontroli procesów od listingu plików
      bazy, kopia zapasowa przez SQLite `.backup` przed startem managera wraz ze sprawdzeniem
      integralności, rozróżnienie odmowy żądania (task zostaje `FAILED`) od nieudanego strict
      resume rozpoczętej próby (`BLOCKED`).
- [x] Pełna walidacja: build, 379 testów JS, 19 + 110 testów Pythona, kontrola dokumentów,
      `git diff --check`.
- [ ] Review użytkownika i decyzja o wdrożeniu (poza tym zadaniem).

## Punkt wznowienia

Implementacja i procedura zostały dostarczone oraz według koordynatora przejrzane.
Koordynator raportuje późniejsze wdrożenie `956b171` i recovery; nie powtarzać historycznej
procedury na aktywnym wave7. Obecny zakres: review lokalnej integracji wave9, potem decyzja
koordynatora o merge/publikacji i kontrola CI. Patrz [wave9](../../plans/wave9.md).
