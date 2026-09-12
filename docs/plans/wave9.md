> Status końcowy: ZAKOŃCZONE. Koordynator zaakceptował review; merge `fb9c843`
> opublikowany za zgodą użytkownika. [CI 34676235601](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/34676235601)
> zakończone SUCCESS (build, 379 JS, 19 exchange, 110 pilot tests).
> Przypięty runtime wave7 pozostał na `956b171`, bez zmian. Poniżej zachowano
> historyczny plan i przekazanie wykonawcy; ich kroki review/publikacji są wykonane.

# Wave9 — integracja timeout/recovery i aktualizacja statusów

Status: GOTOWE DO REVIEW — lokalny zakres wykonany; review, publikacja i CI pozostają. Ten dokument autoryzuje przygotowanie lokalnego brancha do review,
nie push, merge do feature-workflow, wdrożenie ani uruchomienie agentów.

## Cel

Przenieść przejrzaną poprawkę timeout/recovery do brancha integracyjnego opartego na
feature-workflow, uzupełnić rzeczywiste dowody i statusy oraz przygotować samowystarczalny
zestaw do publikacji. Praca jednoagentowa: Astra lokalnie, bez delegowania przez bridge.

## Wejście i stan bazowy

- Repo: McAvity/bidirectional-bridge-claude-codex; branch docelowy feature-workflow.
- Lokalny branch timeout-recovery, oczekiwany tip 956b171, baza aeb92c2.
- Commity wejściowe: 9c18d52 (plan), 569c48e (kod/testy), 4db266c (instrukcje),
  956b171 (poprawiona procedura). Sprawdzić rzeczywisty graf przed integracją.
- Poprawka przeszła niezależne review oraz 379 testów JS. Raport wykonawcy podaje
  dodatkowo 19 exchange i 110 pilot tests. Wykonać kontrole na finalnej integracji.
- Osobny przypięty runtime tej poprawki obsługuje pracujące wave7. Nie należy go
  aktualizować, przebudowywać, usuwać ani zatrzymywać.
- Według raportu managera wave7 prawdziwe recovery zachowało task i natywną sesję,
  zakończyło się po około 6,5 min jako BLOCKED/PARTIAL z kontraktem i blokadą eksportu.
  Kolejna poprawka w tej samej sesji usunęła blokadę; task zakończył się DONE, lecz
  review nadal wymagało zmian. To nie dowód 75-minutowego wywołania ani akceptacji featura.
  Zapisując wynik, odróżnić zgłoszony raport od dowodu samodzielnie sprawdzonego.

## Granice i współbieżność

1. Pracuj wyłącznie we własnym worktree wave9 i katalogach tymczasowych testów.
2. Nie edytuj worktree wave7, jego baz, logów, skilli, dokumentów ani konfiguracji.
   Nie wywołuj jego MCP, recovery ani testów na jego danych. Nie kopiuj bazy live.
3. Nie zmieniaj głównego checkoutu ani przypiętych runtime. Build i testy tylko u siebie.
4. Nie implementuj izolacji managerów, instalatora, retencji, nowej diagnostyki ani
   propozycji review-integration-drift. Nie zamykaj tych zadań przy okazji.
5. Nie uruchamiaj modeli, nie deleguj, nie wykonuj pilotażu wave6 ani nowych prób wave7.
6. Nie pushuj i nie scalaj do feature-workflow. Review i publikację prowadzi koordynator.

## Plan wykonania

### 1. Inwentaryzacja i punkt wznowienia

Sprawdź AGENTS.md, HANDOFF.md, własny branch/cwd/status oraz lokalne referencje.
Zapisz dokładne SHA baz i źródeł w wave9-progress.md. Nie wybieraj zmiennego HEAD
worktree wave7 jako źródła prawdy. Zachowaj cudze zmiany; nie używaj reset/clean.

### 2. Przygotowanie historii integracji

Przejrzyj diff timeout-recovery względem jego bazy, w tym dokumentację i metadane
commitów. Przygotuj integrację na własnym branchu. Nie włączaj implementacji wave7.
Rozwiąż konflikty HANDOFF/statusów tak, by zachować zakończenie wave8 i nowe plany.

Przed cherry-pick/merge sprawdź historię pod kątem prywatnych linków sesji, uchwytów,
transkryptów, odpowiedzi użytkownika i ścieżek maszyny. Nie wciągaj prywatnych metadanych
jako przodków publicznego brancha. Jeśli potrzebna jest oczyszczona kopia commitów,
zachowaj oryginalny branch i zapisz mapowanie źródłowe SHA → SHA integracji. Nie przepisuj
opublikowanej historii ani nie force-pushuj. Zachowaj autorstwo i licencję.

### 3. Aktualizacja dowodów i dokumentacji

- Uzupełnij docs/HANDOFF.md, status timeout-recovery oraz plany mające nieaktualne
  informacje. Rozróżnij: implementacja/review, lokalne wdrożenie przypiętego runtime,
  rzeczywisty wynik recovery, integracja przygotowana i publikacja jeszcze niewykonana.
- Dostępne commity dokumentów wave7 wolno czytać przez git show po przypiętym SHA,
  bez zmiany tego worktree. W raporcie wskaż źródło i zakres zweryfikowanych faktów.
  Jeśli potrzeba prywatnych dowodów, zapisz brak do koordynatora; nie przeszukuj
  automatycznie sesji użytkownika ani nie kopiuj live DB/transkryptów.
- Nie podnoś wave6 z 13/15 do PASS. Kontrolowany REWORK i M-01…M-07 pozostają otwarte.
- Nie deklaruj empirycznej walidacji 75/90 minut ani 200 tur. Krótka udana próba
  potwierdza recovery, nie osiągnięcie wszystkich limitów.
- Dokumentacja ma używać przenośnych przykładów. Rzeczywiste identyfikatory sesji,
  tasków i maszyny nie są potrzebne do publicznej instrukcji wdrożenia.

### 4. Walidacja finalnego brancha

W swoim worktree: npm ci --ignore-scripts, npm run build, npm test,
python3 -m unittest discover -s tests, python3 -m unittest discover -s tools/pilot/tests,
node docs/tools/check-doc-links.mjs, git diff --check. Brak modeli i sekretów w testach.
Sprawdź pełny diff i historię przeznaczoną do publikacji, zgodność skilli obu ról,
konfiguracje i brak prywatnych artefaktów. Raportuj faktyczne wyniki, nie oczekiwane liczby.
Nie aktualizuj zależności tylko z powodu znanych ostrzeżeń audytu.

### 5. Przekazanie do koordynatora

Zapisz wave9-report.md oraz aktualny wave9-progress.md: branch, bazowe i finalne SHA,
mapowanie commitów, zmiany, testy, ograniczenia, pozostawione zadania i następny krok.
Zacommituj tylko własną integrację. Podaj zakres do review i proponowany sposób scalenia.
Pozostaw branch lokalnie, bez merge do feature-workflow, push i zmian runtime.

## Kryteria odbioru

- Przejrzana poprawka jest w samowystarczalnym branchu; runtime wave7 jest nietknięty.
- Testy finalnej integracji i dokumentacji przechodzą.
- Statusy odróżniają dowody rzeczywiste od testów z atrapą i brakujących kontroli.
- Publiczny zestaw plików oraz historia nie zawierają prywatnych materiałów.
- Oryginalne commity pozostają zachowane, mapowanie jest czytelne, licencja zachowana.
- Koordynator może wykonać review i publikację bez odtwarzania tej rozmowy.

Wave9 jest zakończony dopiero po review koordynatora, integracji do feature-workflow,
publikacji i weryfikacji CI. Wykonawca kończy swój zakres statusem GOTOWE DO REVIEW,
a nie deklaracją zakończenia całego wave9.
