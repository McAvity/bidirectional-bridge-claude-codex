# Wave9 — GOTOWE DO REVIEW

Lokalny zakres przygotowania integracji wykonany. Nie wykonano push, merge do
feature-workflow, wdrożenia, delegowania, wywołań modeli ani recovery wave7.

## Zakres do review i SHA

- Branch: `wave9-integration`, własny worktree Herdr `test`, początkowo czysty.
- Baza integracji z planem: `354c051371b7e5568c4ef34237eb8fa71bf11a76`.
- Baza poprawki: `aeb92c2f35670b73aa9e204f68f3734d2ad2cc37`.
- Oryginalny tip: `956b1710a779ece310159025ccc8f00be4cad141` na zachowanym timeout-recovery.
- Finalny import źródła: `fa6557642b622aadff763119627fd93839b269dd`.
- Integracja i aktualizacja statusów: `1459786b0f53ac47adb5a1ac3315853b2ce18f47`.
- Końcowy commit dodaje ten raport i domyka postęp; jego SHA to
  `git rev-parse wave9-integration`. Zakres review: `354c051..wave9-integration`.
  SHA commita zawierającego raport podaje też końcowe przekazanie wykonawcy.

## Pochodzenie i prywatność

| Źródło | Oczyszczony import |
| --- | --- |
| `9c18d522ec8453225b555b5e703862a4015349b6` | `69cda2b2dc3b0fea079f1db85a87eb122ecae50c` |
| `569c48ee74f8d31ba56228c0693cd56375957bf7` | `4c06e218e7903064142fb36be187fb8676c1e999` |
| `4db266cdd8b26fae10d80d67a3371b13ec71c764` | `13c753fa12047730b97d6b8293311bffbb78268c` |
| `956b1710a779ece310159025ccc8f00be4cad141` | `fa6557642b622aadff763119627fd93839b269dd` |

Z komunikatów wszystkich czterech commitów usunięto prywatny trailer sesji.
Rzeczywisty identyfikator taska zastąpiono `<task-id>`. Ścieżkę maszyny z wcześniejszych
wersji PLAN/PROGRESS zastąpiono `<local-workspace>` — kontrola samego tipa nie wystarczała.
Oryginalne źródła pozostają lokalnie; nie są przodkami brancha integracyjnego.
Nie przepisywano upstream, feature-workflow ani timeout-recovery. Autor, data autora,
współautorstwo i MIT zachowane. Nie publikować przez merge oryginalnego timeout-recovery.

Porównano wszystkie zmienione pliki każdego importu z odpowiadającym źródłem po tych
redakcjach; jedyną dodatkową różnicą przy imporcie był zachowany wpis planu wave9 w HANDOFF.
Sprawdzono metadane i pośrednie drzewa, listę nowych plików oraz finalny diff.
Kod, testy, skille, konfiguracje, manifesty i lockfile są identyczne ze źródłem `956b171`.
Nowe pliki to źródła, testy i dokumentacja; brak baz, transkryptów, realnych odpowiedzi,
sekretów lub osobistej konfiguracji w dodanym zestawie. Fixture handles pozostają syntetyczne.
Audyt dotyczy nowego zakresu publikacji; nie jest gwarancją wykrywania dowolnego sekretu
ani ponowną certyfikacją całej odziedziczonej historii upstream.

## Zmiany i dowody

Import: jawne recovery timeoutu z nowym deadline’em, budżet próby, dowody zakończenia,
limit 256 tur (default 12), konfiguracja 75/90 minut i zgodne instrukcje obu ról.
Statusy HANDOFF, wave7, wave9 i timeout-recovery rozdzielają dostawę, review, zgłoszone
wdrożenie i wyniki runtime od lokalnej integracji oraz przyszłej publikacji.
Procedura wdrożenia jest historycznym przykładem, używa przypiętego SHA i wymaga
sprawdzenia także indexu/working tree przed dostarczeniem instrukcji.

Źródło faktów o niezależnym review poprawki, wdrożeniu przypiętego runtime oraz recovery
około 6,5 min do BLOCKED/PARTIAL: raport koordynatora zapisany w planie wave9 @ `354c051`.
Samodzielnie odczytano wyłącznie dokumenty z przypiętego
`88d17073a58d8ac5d7e7e94acb91a3da725ec598` przez git show:
`docs/features/F-W7-manager-isolation/PROGRESS.md` i `reviews/03-corrections.md`.
Raportują kolejną próbę tej samej sesji, DONE dostawy i usunięcie blokady eksportu,
ale REWORK kontraktu i brak akceptacji featura. Potwierdzono treść raportów,
nie zdarzenia prywatnej bazy, transkrypt ani integralność prywatnej paczki.
Nie odczytywano zmiennego HEAD wave7 jako źródła i nie zmieniano jego worktree,
bazy, logów, konfiguracji ani przypiętego runtime. Nie budowano głównego checkoutu.

## Walidacja

Środowisko: Node 24.15.0, Python 3.12.3. Kod końcowej integracji identyczny z kodem
z chwili testów; późniejsze zmiany dotyczą wyłącznie dokumentów i oczyszczenia historii.

| Kontrola | Wynik |
| --- | --- |
| `npm ci --ignore-scripts` | PASS |
| `npm run build` | PASS |
| `npm test` | 379/379, 25 plików PASS |
| `python3 -m unittest discover -s tests -v` | 19/19 PASS |
| `python3 -m unittest discover -s tools/pilot/tests -v` | 110/110 PASS |
| `node docs/tools/check-doc-links.mjs` | PASS, 30 plików w zakresie skryptu |
| `git diff --check 354c051` | PASS na końcowym drzewie |
| Porównanie using-bridge Codex/Claude | identyczne |
| Import: drzewa, metadane, autorstwo, brak prywatnych przodków | PASS po redakcji |

Lokalne logi testów: `/tmp/wave9-{npm-ci,build,js,python,pilot}.log`; nie są wejściem
projektu ani częścią commita. Pierwsza izolowana próba shell zakończyła się błędem bwrap;
operacje wykonano następnie przez zatwierdzoną eskalację, nadal w tym worktree.
Końcowa kontrola wykryła dodatkową pustą linię w progress; usunięto ją w commicie raportu.

## Ograniczenia i zadania pozostawione

- Instalacja zgłosiła 5 podatności: 4 moderate, 1 high. Bez aktualizacji zależności.
- Python 3.11 nie był ponownie testowany. CI po publikacji jeszcze niewykonane.
- Testy z atrapą nie certyfikują real-agent path. Nie osiągano empirycznie 75/90 minut
  ani 200 tur; krótkie zgłoszone recovery tego nie dowodzi.
- Wave6 pozostaje 13/15; kontrolowany REWORK i M-01…M-07 otwarte.
- Izolacja managerów, diagnostyka/retencja, instalator, odbiór wave7 i propozycja
  review-integration-drift pozostają poza zakresem. Nie wdrożono ich przy integracji.
- Prywatne dowody runtime, jeśli potrzebne do review, powinien sprawdzić koordynator;
  nie kopiować live DB ani transkryptów do repozytorium.

## Dokładny następny krok koordynatora

1. Przypiąć tip przez `git rev-parse wave9-integration`, sprawdzić
   `git log --format=fuller 354c051..wave9-integration` oraz
   `git diff 354c051..wave9-integration`. Rozliczyć mapowanie powyżej i statusy dowodów.
2. Porównać aktualny feature-workflow z bazą `354c051`; przy równoległych zmianach
   scalić dokumenty w osobnym worktree integratora, zachowując nowsze fakty wave7.
   Dostawę recovery oceniać oddzielnie od proponowanych kontraktów wave7.
3. Po akceptacji proponowany merge tego oczyszczonego brancha z zachowaniem commitów
   (`--no-ff`), ponowna walidacja wspólnego wyniku, push przez koordynatora i kontrola CI.
   Nie dołączać oryginalnych prywatnych commitów przez merge timeout-recovery.
4. Pozostawić aktywny runtime wave7 przypięty. Ewentualne późniejsze wdrożenie stanowi
   osobną decyzję; review integracji nie jest poleceniem recovery ani restartu wave7.

Całe wave9 można zamknąć dopiero po review, integracji, publikacji i weryfikacji CI.
