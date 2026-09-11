# Kryteria odbioru — timeout recovery

Odbiór techniczny wymaga wszystkich punktów. Testy z atrapą wykonawcy nie są dowodem
przebiegu z prawdziwym modelem; takiego przebiegu w tym zadaniu nie wykonujemy.

- **AC-TR-01 Jawne wznowienie.** Istniejący task `FAILED` z próbą zakończoną `TIMEOUT` i
  zachowanym uchwytem da się wznowić wyłącznie wywołaniem
  `bridge_resume_delegated_task` z `recover_timeout: true`, `deadline_ms` i
  `idempotency_key`. Ten sam task ID, właściciel, lineage, feature i uchwyt sesji; nowa
  sąsiednia próba z `resumed_from_attempt` w historii; wynik próby historycznej, jej
  `ended_at` i telemetria bez zmian. Działa po restarcie bridge’a i dla rekordów
  utworzonych przed poprawką.
- **AC-TR-02 Selektywność.** Odrzucenie bez inwokacji i bez nowej próby: brak uchwytu,
  inna przyczyna `FAILED`, niewłaściwy manager/caller, aktywna próba lub lease,
  `waiting_user`/`accepted`, nie-najnowszy task featura, brak klucza lub deadline’u,
  tryb timeout przez `bridge_resume_task` lub dla taska nie-`FAILED`.
- **AC-TR-03 Brak zastępczej sesji.** Odmowa strict resume (inny lub brak potwierdzonego
  uchwytu) kończy próbę błędem i `BLOCKED`; nie powstaje nowy task, nowa sesja ani druga
  inwokacja. Brak uchwytu blokuje przed uruchomieniem runtime.
- **AC-TR-04 Deadline.** Recovery timeoutu wymaga jawnego `deadline_ms` (1 000–86 400 000),
  który wyznacza `deadline_at`, timer i TTL lease; poprzedni deadline nie jest używany
  automatycznie. Opcjonalny `max_turns` dotyczy tylko tej próby. Zdarzenia zapisują
  użyty deadline.
- **AC-TR-05 Idempotencja.** Powtórzenie tego samego żądania (w trakcie i po zakończeniu,
  także z innego procesu) nie tworzy drugiego wykonania; zmienione argumenty z tym samym
  kluczem → `IDEMPOTENCY_MISMATCH`; nowy klucz nie uruchamia drugiego wykonania.
- **AC-TR-06 waiting_user.** Zapis odpowiedzi nie uruchamia wykonawcy; recovery w
  `waiting_user` jest odrzucane.
- **AC-TR-07 Długie rundy.** Dokumentacja rozdziela deadline wykonawcy i timeout MCP oraz
  opisuje ich współdziałanie. Konfiguracja 75 min / 90 min jest w repo; limity kodu i
  klientów sprawdzone w źródłach (Codex 0.154.0, TS SDK, Claude Code 2.1.269), z jawnie
  opisanymi niesprawdzonymi punktami. Limit tur nie ucina 75-minutowej rundy strukturalnie.
- **AC-TR-08 Dowody.** Po timeout/cancel/braku result frame istnieje plik dowodu
  (lokalizacja, limit 16 KiB stderr, uprawnienia 0600, brak nadpisywania) z metadanymi i
  zredagowanym ogonem stderr; brak promptu, uchwytu, sekretów i treści transkryptu;
  nic na stdout MCP; `bridge_get_task` pokazuje tylko metadane. Opisany sposób odczytu.
- **AC-TR-09 Instrukcje.** bridge-loop, feature-execute, using-bridge (obie kopie
  identyczne) i docs nie zawierają sprzeczności z nową obsługą; zakaz zastępczych sesji
  zachowany; timeout recovery tylko po jawnej autoryzacji dodatkowego czasu.
- **AC-TR-10 Procedura.** DEPLOY-AND-RESUME.md opisuje wdrożenie sprawdzonego runtime
  obok aktywnego i późniejsze wznowienie `<task-id>`; gotowa do review, niewykonana.
- **AC-TR-11 Walidacja.** `npm ci --ignore-scripts`, `npm run build`, `npm test`, oba
  zestawy testów Python i `git diff --check` przechodzą w worktree zadania.
- **AC-TR-12 Granice.** Brak zmian w aktywnym runtime, bazach i worktree wave7; brak push,
  wdrożenia i uruchomienia zachowanego taska; brak ręcznej edycji SQLite.
