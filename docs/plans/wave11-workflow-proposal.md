# Wave11 — propozycja instrukcji i scenariusze

Status: PROPOZYCJA, **nie wdrożono**. Podstawa: [raport](wave11-report.md), obserwacje
O1–O9 i zalecenia Z1–Z5. [Dokładny diff](wave11-workflow-proposal.patch) powstał względem
`b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`. To materiał do osobnej akceptacji zaleceń,
nie nowy obowiązujący skill, polecenie uruchomienia agentów ani zgoda na zmianę produktu.

## Co zmienia diff

Sześć plików, pięć reguł zachowania; bez nowych skilli, narzędzi, statusów runtime,
rejestru w bazie czy obowiązkowego szablonu „step back”.

| Plik docelowy | Dokładny obszar propozycji i powiązanie |
| --- | --- |
| `docs/features/README.md` | Rozdzielenie blockerów/uwag/osobnych zadań (Z1), datowany rejestr zamiast dokumentu każdej korekty (Z2), niezależność od wykonawcy i cel dodatkowego reviewera (Z3), krok wstecz także przy postępie (Z4), dostępny dowód przed pytaniem (Z5). Usuwa sprzeczny bezwarunkowy wymóg osobnej sesji poza managerem. |
| `.agents/skills/feature-review/SKILL.md` | Te same dyspozycje i niezależność; korekty śledzą otwarte ID i konkretne regresje. Zmienia obowiązek następnego `reviews/NN` na możliwość dopisku w istniejącym rejestrze. Nowa faza nadal uzasadnia osobne review. |
| `.agents/skills/feature-execute/SKILL.md` | Rozróżnia zakres rundy od autoryzacji pozostałego featura, precyzuje niezależność reviewera, kieruje do kroku wstecz przed kolejną poprawką. |
| `.agents/skills/feature-execute/references/bridge-loop.md` | Usuwa kolidujący nakaz nowego dokumentu co rundę i uzasadnienie „postęp wystarcza”. Zachowuje reviewed task/revision, verify paczki i jawne wyniki ustaleń. |
| `.codex/skills/using-bridge/SKILL.md` oraz `.claude/skills/using-bridge/SKILL.md` | Identyczne doprecyzowanie proporcjonalnej weryfikacji i odesłanie do wspólnej reguły nawrotu. Nie wprowadza nowego kanału delegacji. |

Nie trzeba zmieniać `feature-decide`: już zabrania nowej decyzji dla lokalnego PASS
oraz autoryzowanej korekty i wymaga rzeczywistego odbioru. Nowa propozycja nie znosi
ograniczenia task-only, bramki zewnętrznej, budżetu ani reguły recovery po timeout.
Nie zmienia też schematu structured evidence, obowiązku poprawnej paczki przy wymaganym
przekazaniu ani zakazu edycji zapisów koordynatora przez wykonawcę.

Własne poprawki koordynatora nadal wymagają innej osoby/sesji, jeśli wynik ma być
nazwany niezależnym review. Gdy koordynator sam poprawia mały wrapper testowy, ujawnia
samokontrolę tego fragmentu; nie traci przez to automatycznie możliwości niezależnej
oceny osobno napisanych zmian Claude’a. Zakres niezależności musi być prawdziwy.

Istniejące dwa kolejne `no progress` nadal wymagają przedstawienia konkretnego impasu.
Trzecie sprawdzenie przy **postępie** dodaje refleksję nad podejściem, nie kolejną
bramkę i nie nowy licznik w narzędziu. Przy znanym prostym rozwiązaniu można je
wybrać wcześniej. Liczba trzy jest heurystyką, a nie wynikiem optymalizacji kosztu.

## Scenariusze sprawdzające propozycję

Przeprowadzono ręczne przejście scenariuszy poniżej po tekście proponowanych reguł.
To sprawdzenie spójności decyzji, nie test zachowania modeli ani ponowne wykonanie
historycznych reprodukcji. Nie dodano testów automatycznych, które jedynie sprawdzają
występowanie słów w instrukcjach.

| Scenariusz i wejście | Oczekiwany krótszy przebieg | Co nadal zatrzymuje dostawę / wynik analizy |
| --- | --- | --- |
| S1. R09-03: odmówione H odtwarza plik przed sprawdzeniem CAS; testy ogólne PASS | Blocker AC-02 z kontrprzykładem; poprawka kolejności guard/repair i ukierunkowany test; dopisek do otwartego findingu. | Odmowa z zapisem nadal blokuje. Nie można nadać advisory z powodu wielu rund. Reguły Z1/Z2 zachowują ten wynik. |
| S2. R03-01: nie sprawdzono źródła native ID | Zbadać dostępny kanał w istniejącej zgodzie, zachować AC-03. Jeśli brakuje istotnego dostępu — BLOCKED tego ustalenia, kontynuacja niezależnych korekt. | Brak krytycznego dowodu nigdy nie staje się PASS. Z5 usuwa przedwczesne pytanie o obniżenie wymagania, nie obowiązek jego spełnienia. |
| S3. R02-06: ledger wskazuje pre-amend hash, ale Git i paczka jednoznacznie identyfikują zakres | Uwaga nieblokująca, wyjaśnienie w najbliższym właściwym wpisie bez nowej rundy wyłącznie dla tekstu. | Gdy zakres przestaje być ustalalny, to inny przypadek — brak essential evidence jest blockerem. Z1 rozróżnia oba. |
| S4. R03/R04/R05: trzeci nawrót bootstrap/crash; każda poprawka robi postęp | Krótkie rozważenie prostszego protokołu w istniejącym wpisie: jedna serializacja, autorytatywny stan, naprawa wyłącznie po guardzie; wybrać lub uzasadnić zachowanie podejścia. | Nie wolno usunąć testu dwóch managerów ani dozwolonego `--db` pod hasłem uproszczenia. Trzeci raz nie daje PASS i nie wymaga pytania. Z4 zachowuje oba warunki. |
| S5. Po naprawie R09-02 pojawia się R11-01: replay zwraca wynik, ale `result()` zapisuje po takeover | Nowe ustalenie powiązane z klasą „odczyt/guard”, sprawdzenie ścieżki odpowiedzi i pure view. | Nie oznaczać „już zamknięte” tylko dlatego, że oba findingi mówią o replay. Z2 wymaga zachowania nowego defektu. |
| S6. R15 PASS, C0 chce zamknąć własny R13 | Sprawdzić dokładny diff, zachowane dowody i finalną paczkę w potrzebnym zakresie; dopisać closure R13 z wersją i jedną rekomendacją do odbioru. | Nowe ryzyko lub wymagana zewnętrzna kontrola może uzasadnić dodatkowego reviewera. Sam fakt kolejnego numeru nie wystarcza. Bez osobnego R16 jest nadal audytowalne zamknięcie. |
| S7. R14: dodatkowy reviewer potrafi zbadać wpływ środowiska Git | Jawne wąskie pytanie: czy `--repo B` nadal wybiera B przy zmiennych A? Reviewer odtwarza błąd, manager zleca korektę. | Z3 dopuszcza wartościowe dodatkowe review; nie nakazuje wyłącznie samokontroli ani eliminacji drugiego reviewera. |
| S8. W9: tip czysty, prywatny wpis w publikowanym pośrednim drzewie | Blocker publikacji; oczyszczenie lokalnego importu, sprawdzenie zmienionych drzew/metadanych i mapowania. Zachować źródło. | Nie przenosić usunięcia znanej prywatnej treści po push do „osobnego zadania”. Nie uruchamiać szerszego projektu diagnostyki. Z1 zatrzymuje konkretną publikację. |
| S9. W9: ostrzeżenia zależności i brak realnego testu 75/90 min, plan nie wymaga takich prób | Zapisać ograniczenia i osobną pracę; nie podnosić twierdzeń o empirycznej walidacji. Kontynuować import w zleceniu. | Gdy dany realny test jest jawnym kryterium aktualnego odbioru, brak dowodu blokuje ten odbiór. Z1 nie zmienia AC. |
| S10. PASS kontraktu, pełna implementacja już autoryzowana; wariant: tylko kontrakt autoryzowany | W pierwszym przypadku następna gotowa runda bez pytania. W drugim zakończyć konkretny zakres i przedstawić brakującą decyzję. | Z5 nie zamienia zgody na projekt w zgodę na produkt. Rejestr musi rozdzielać zakres rundy i zachowaną zgodę featura. |
| S11. PASS implementacji, odbioru użytkownika jeszcze nie ma | Jedna rekomendacja z zakresem i ograniczeniami, oczekiwanie na rzeczywisty odbiór. | Nie wywoływać accept na podstawie PASS lub ciszy. Z5 i niezmienione feature-decide/bridge-loop zachowują odrębną akceptację. |
| S12. Bubblewrap lub automatyczna odmowa publikacji | Standardowa eskalacja, dostępne bezpieczne kontrole, dokładne wyjaśnienie blokowanej akcji i powodu. Kontynuacja niezależnej pracy. | Skill nie znosi zewnętrznych uprawnień. Nie zastępować zgody własnym PASS ani naprawiać środowiska poza zakresem. |
| S13. Koordynator sam napisał poprawkę, brak zgody na kolejnego agenta | Samokontrola jawnie ograniczona, dostępne testy, bez twierdzenia o niezależności; kontynuować pozostałą autoryzowaną pracę. | Jeśli niezależny odbiór jest wymagany, brak reviewera pozostaje realną luką. Z3 nie udziela zgody na delegację. |
| S14. Dwie rundy na tym samym blokerze formatu, brak postępu | Sprawdzić wymagany format lokalnie; jeśli zwykła korekta rozwiązuje go w zgodzie, wykonać ją. Przy rzeczywistym impasie wskazać przyczynę i konkretną potrzebną decyzję zgodnie z dotychczasową regułą. | Trzecie review nie służy do obejścia istniejącego limitu lub powtarzania bez końca nieudanej operacji. |

Wynik przejścia: w tych scenariuszach nie znaleziono reguły pozwalającej zaakceptować
istotny bug, brak krytycznego dowodu lub zastąpić odbiór użytkownika. Wskazane ryzyko
pozostaje praktyczne: agent może źle ocenić wagę findingu lub nazwać nowy bug powtórzeniem.
Dlatego zachowujemy wymaganie dowodu/wpływu oraz jawne nowe ID, zamiast samego limitu rund.

## Sprawdzenie i przyszła decyzja

`git apply --check docs/plans/wave11-workflow-proposal.patch` sprawdza dopasowanie
bez nakładania zmian. Właściwe wdrożenie, jeśli zalecenia zostaną zaakceptowane, wymaga
osobnego commita na aktualnej bazie; zachować późniejsze zmiany namespace i ról.
Nie należy stosować patcha na pracujący wave7/wave10 ani do nadzorującego runtime.

Obserwacja skuteczności w następnym, osobno zleconym feature może być krótkim wpisem
w jego progress: przykład zachowanego blokera, wynik kroku wstecz, powód dodatkowego
reviewera i źródło końcowej akceptacji. To nie obowiązek uruchomienia eksperymentu
ani warunek zamknięcia analizy wave11. Nie obiecujemy oszczędności czasu lub tokenów.
