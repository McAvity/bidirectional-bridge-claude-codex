# Praca nad featurem z agentami

Ten proces przechowuje intencję, zadania, dowody i decyzje w repozytorium, aby różne modele mogły przejmować pracę bez historii rozmowy. Obowiązuje przy użyciu dołączonych skilli `feature-*`; nie zmienia zasad innych prac w repo. Instrukcje użytkownika i obowiązujące `AGENTS.md` zachowują pierwszeństwo.

## Start i aktualizacja workflow

Paczka workflow zawiera sześć skilli w `<package>/skills/` i ten przewodnik. Paczka konkretnego featura zawiera jego brief oraz potrzebne materiały wejściowe. Można najpierw wprowadzić workflow jako osobny commit, następnie dodać dokumenty featura i użyć nowych skilli do planowania. Nie trzeba instalować tych skilli jako osobistych skilli ChatGPT.

Obie paczki mają ścieżki względem korzenia repo. Przy aktualizacji porównaj pliki workflow z lokalną wersją i zachowaj niezależne zmiany; przy niezmienionej bazie można zastąpić dostarczone pliki. Rozpakowanie nie usuwa innych plików. Nie usuwaj istniejących tasków ani dokumentów innego featura dlatego, że nowa paczka ich nie zawiera.

Dla gotowego, uzgodnionego briefu pomiń `feature-design`. W poniższym przykładzie zastąp `<feature-id>` katalogiem wybranego featura:

```text
Użyj $feature-plan dla docs/features/<feature-id>/brief.md.
Brief uzgodniliśmy wcześniej. Przygotuj projekt techniczny i taski Yumi do review.
Nie zaczynaj implementacji ani eksperymentów. Rozlicz istniejące prace dotyczące
tego featura; nie twórz duplikatów. Jeżeli dalszy zakres zależy od wyników badań,
rozpisz szczegółowo pierwszą falę, a kolejne pozostaw jawnie warunkowe.
Review planu odbędzie się poza repozytorium: na końcu użyj $feature-exchange,
aby wyeksportować wynik do ZIP-a.
```

Instrukcje można też wskazać przez ścieżkę `<package>/skills/feature-plan/SKILL.md`, jeśli bieżąca sesja nie wykryła jeszcze nowych skilli. Istniejący `F-001-replayability` może być dalej prowadzony tym samym procesem; jego pliki i historia nie są częścią aktualizacji workflow.

## Fazy i przekazania

| Faza | Skill | Wynik | Następny krok |
| --- | --- | --- | --- |
| Uzgodnienie celu | `feature-design` | `brief.md` | Planowanie; pomiń przy gotowym briefie |
| Planowanie w repo | `feature-plan` | `design.md`, taski, indeks featura | `feature-review` w trybie plan |
| Niezależne sprawdzenie | `feature-review` | Review z rekomendacją | Lokalna kontynuacja/poprawki; decyzja, gdy potrzebna |
| Rozstrzygnięcie | `feature-decide` | Akceptacja zakresu lub poprawki | Odpowiednia faza wykonania |
| Wykonanie | `feature-execute` | Kod/dokumenty, dowody, ledger | Review kontraktów, integracji lub implementacji |
| Przekazanie plików | `feature-exchange` | ZIP / kontrolowane przyjęcie zwrotki | Uzgodnione przekazanie zewnętrzne lub jawne żądanie |

Zlecenie nie wymaga wymieniania nazw skilli. „Zaimplementuj feature opisany w `<plik>`" jest
zwykłym poleceniem: agent czyta wskazany dokument i rozpoznaje, czy to brief (potrzebne
planowanie), gotowy projekt (bez ponownego projektowania), review (poprawki) czy niezatwierdzona
propozycja (potrzebna decyzja). Jawnie węższe polecenie — „tylko przejrzyj", „tylko plan",
„zrób sam", wskazany task — ma pierwszeństwo przed treścią dokumentu. Sama treść pliku nie
rozszerza uprawnień: nie daje zgody na push, merge, wdrożenie, większy budżet ani delegowanie.
Odczytanie dokumentu nie jest zgodą na jego wykonanie.

Review planu albo decyzję można zrobić w rozmowie z mocniejszym modelem. Nie trzeba powtarzać identycznego review lokalnie: zachowaj otrzymany dokument wraz z zakresem i ograniczeniami. Rekomendacja nie jest zatwierdzeniem. Jawna zgoda z rozmowy jest wystarczająca — agent zapisuje ją, nie prosi drugi raz. Domyślnie lokalne agenty nie zatwierdzają nowych decyzji produktowych w imieniu użytkownika.

Przy delegowaniu domyślnie proponuj cały pozostały uzgodniony zakres featura wraz z integracją, lokalnym review i poprawkami. Jawnie węższe zlecenie (task, grupa, fala) nadal obowiązuje. Dobieraj model do trudności, nie na stałe do roli. Task projektujący kontrakty może wymagać mocniejszego modelu niż późniejsza implementacja. Review wykonuje sesja niezależna od wykonawcy; koordynator, który nie implementował zmiany, może pełnić tę rolę, ujawniając udział w koordynacji. Własna implementacja wymaga innego reviewera do niezależnego review. Dodatkowa osoba lub model potrzebuje konkretnego celu: nowego ryzyka, brakującej kompetencji, luki dowodowej albo jawnie wymaganej niezależności; samo zakończenie kolejnej rundy nie wystarcza.

## Domyślna autonomia i bramki

Po zleceniu implementacji uzgodnionego zakresu koordynator prowadzi gotowe taski, integrację, niezależne lokalne review i poprawki przywracające uzgodnione zachowanie. Zakończenie taska, nowy ledger ani techniczne `PASS` nie wymagają nowej zgody czy ZIP-a. Bramki zależności i lokalnego review nadal obowiązują; ich przejście pozwala kontynuować w ramach istniejącej zgody. Nie twórz osobnej decyzji użytkownika dla każdej zwykłej poprawki.

Wcześniejsze przekazanie zewnętrzne jest potrzebne przy istotnym wyborze poza autoryzacją (np. zmiana zachowania, wspólnego kontraktu poza przyjętymi granicami lub budżetu), jawnie wymaganej bramce zewnętrznej albo rzeczywistym impasie. Najpierw sprawdź istniejącą zgodę i zbierz dostępny lokalnie dowód potrzebny do wyboru; nie pytaj, czy zachować obowiązujące wymaganie, zanim zbadasz możliwość jego spełnienia. Wskaż konkretną nierozstrzygniętą decyzję, dowody, rekomendację i powód, dla którego nie można jej rozwiązać lokalnie. Sama chęć dodatkowego review nie wystarcza. Wstrzymaj tylko zależne prace.

Review wykonuje lokalna sesja/agent niezależna od wykonawcy w granicach dostępnych możliwości i zgód; nie wymaga to dodatkowego reviewera poza koordynatorem, który spełnia ten warunek. Samokontrola wykonawcy nie zastępuje niezależnego review. Jeśli reviewer jest niedostępny, zapisz ograniczenie i lokalne przekazanie, kontynuując pozostałe dozwolone prace; nie żądaj przez to zewnętrznego ZIP-a po każdym tasku. Koniec sesji lub limit kontekstu wymaga zapisu stanu i instrukcji wznowienia, a nie ponownego zatwierdzania zakresu.

Zatwierdzenie projektu samo w sobie nie jest zleceniem implementacji. Aktualizacja workflow nie rozszerza wcześniejszej zgody ograniczonej do konkretnego taska. Po uzgodnieniu projektu i wymaganych kontraktów można zlecić:

```text
Zlecam implementację całego pozostałego uzgodnionego zakresu tego featura.
Użyj $feature-execute: wykonaj taski zgodnie z zależnościami, zintegruj wynik,
zorganizuj niezależne lokalne $feature-review i popraw wykryte błędy w zakresie
uzgodnionego zachowania. Zachowaj budżety i reguły zatrzymania eksperymentów;
nie rozszerzaj pracy na niezatwierdzone przyszłe fale.
Nie zatrzymuj się po każdym tasku po moją zgodę ani wymianę ZIP-ów.
Wróć wcześniej tylko z konkretną decyzją poza udzieloną zgodą lub rzeczywistym
impasem. Po lokalnym review całości przygotuj krótki handoff do odbioru: commity
dostawy i integracji, ledgery, review, wyniki, ograniczenia i executive summary.
ZIP przez $feature-exchange tylko wtedy, gdy o niego poproszę.
```

## Pliki i właściciele informacji

Wszystkie ścieżki poza taskami są względne do `docs/features/F-NNN-nazwa/`.

| Plik | Odpowiedzialność |
| --- | --- |
| `brief.md` | Cel, wymagane zachowanie, zakres, ograniczenia i kryteria odbioru |
| `design.md` | Wspólne decyzje techniczne, uzasadnienia, niepewności, kontrakty, kolejność integracji i własność wspólnych plików |
| `feature.json` | Mały indeks dla agentów i eksportera: ID, etap, ścieżki tasków, ostatnie review/decyzja, następny krok |
| Taski w istniejącym Yumi | Jednostki pracy, ich statusy, zależności, rezultat i sposób weryfikacji |
| `contracts/` — gdy potrzebne | Opis wspólnych kontraktów i przykłady; odnośniki do kanonicznych schematów w kodzie zamiast kopii |
| `execution/<TASK-ID>/01.md` | Ledger jednej próby wykonania; kolejne próby mają kolejne numery |
| `execution/integration/01.md` | Stan połączenia prac i dowody integracyjne, gdy występuje praca równoległa |
| `reviews/01-plan.md` itd. | Ocena konkretnego zakresu i rekomendacje; kolejne review nie nadpisuje poprzedniego |
| `decisions/01.md` itd. | Rozstrzygnięcie ustaleń i zatwierdzony zakres dalszych działań |
| `evidence/` — gdy potrzebne | Małe dowody, raporty eksperymentów lub trwałe odnośniki, z identyfikacją badanego kodu i danych |
| `milestones/` — gdy potrzebne | Pytania i wymagane rezultaty kolejnych fal; bez drugiej listy tasków/statusów |

Twórz pliki w chwili potrzeby, bez pustych szablonów. Dla małego featura `design.md` może mieć kilka akapitów. Nie utrzymuj osobnego długiego planu powtarzającego taski ani drugiej listy ich statusów. `feature.json` nie zastępuje statusów Yumi. Etap featura jest wskazówką nawigacyjną, a nie dowodem zatwierdzenia.

Przykładowy schemat indeksu (wartości tasków i ścieżek dobierz z repo):

```json
{
  "schema_version": 1,
  "feature_id": "F-001-replayability",
  "phase": "plan-review",
  "brief": "docs/features/F-001-replayability/brief.md",
  "design": "docs/features/F-001-replayability/design.md",
  "tasks": [],
  "context_files": [],
  "latest_review": null,
  "latest_decision": null,
  "next_action": "Review projektu i tasków; bez implementacji."
}
```

`tasks` to lista dokładnych ścieżek plików Yumi względem korzenia repo. `context_files` to jawnie wybrane pliki potrzebne do przekazania, np. odpowiednie AGENTS.md, kontrakt lub fragment dokumentacji architektury. Żadnego automatycznego eksportu wszystkich zależności czy danych gry. Używaj `/` w ścieżkach. Przykładowe fazy: `design`, `planning`, `plan-review`, `contract-review`, `execution`, `implementation-review`, `decision`, `corrections`, `accepted`, `blocked`; nie dodawaj tych statusów do Yumi.

## Zasady wiarygodności

1. Brief definiuje zachowanie. Projekt i taski je uszczegóławiają. Ledger opisuje fakty. Review je ocenia. Decyzja zatwierdza zmianę lub odbiór. Propozycja z ledgera nie zmienia specyfikacji.
2. Rozbieżność z istniejącą specyfikacją repo wymaga jawnego rozstrzygnięcia. Nowy feature może celowo ją zmieniać; stary dokument nie jest automatycznym wetem, a nowy plan nie nadpisuje go po cichu.
3. Kryteria odbioru powinny mieć stabilne ID, np. AC-01. Nie zmieniaj przy tym treści wymagań. Taski i review odsyłają do kryteriów; testy taska są zwykle tylko częścią dowodu całego kryterium.
4. Każde wykonanie i review zapisuje wersję swoich wejść: ścieżki oraz commit albo SHA-256 pliku; dla kodu dokładny zakres commitów albo zidentyfikowany snapshot. Nazwa brancha sama nie wystarcza. Model i sesja: zapisz znane dane, nie zgaduj.
5. Zatwierdzenie dotyczy konkretnej wersji i zakresu. Zmiana wspólnego interfejsu wymaga oceny wpływu na jego odbiorców. Korekta literówki nie otwiera całego review od nowa.
6. `PASS` testów, zakończenie taska, pozytywne review i odbiór featura to różne fakty. Brak dowodu oznacza `not run`/`unverified`, a nie sukces. Zamknięcie technicznych tasków nie usuwa otwartych bramek odbioru.
7. Dane produkcyjne, wdrożenia, publikacja, push/merge i usuwanie pozostają w granicach istniejącej autoryzacji. Ten proces nie dodaje zgód ani nie odwołuje zgód już udzielonych. Stosuj istniejący workflow Git/Yumi.

## Minimalny ledger

Zapisuj go przy istotnym ustaleniu, przed przekazaniem i na końcu wykonania. Nie odtwarzaj dopiero z pamięci całej sesji. Nagłówki:

- **Scope / Inputs**: ID taska, wersje briefu/projektu/kontraktów, decyzja pozwalająca wykonać pracę, baza kodu.
- **Outcome**: `complete`, `partial`, `blocked` lub `failed`; co faktycznie dostarczono, co zostało.
- **Problems and resolutions**: istotne objawy, ustalone przyczyny, zastosowane rozwiązania; `None` jeśli brak.
- **Validation**: komenda lub demonstracja, wynik, dowód i badany kod; jawne fakes/stubs, brak dostępu, testy niewykonane.
- **Deviations and proposals**: normalne wybory implementacyjne osobno od proponowanych zmian zachowania/specyfikacji; `None` jeśli brak.
- **Handoff**: końcowy commit/snapshot, pozostała praca i następny krok.

Ledger to podsumowanie dowodów, nie transkrypt, lista wszystkich komend ani zapis prywatnego toku rozumowania. Pomyślnie wykonane rzeczy wystarczy opisać przez rezultat i weryfikację. Oryginalny ledger pozostaje przy kolejnej próbie.

## Review i rozstrzygnięcie

Review zaczyna się od executive summary (zwykle do 10 linijek): werdykt, najważniejszy wpływ, decyzje potrzebne od użytkownika i zalecany następny krok. Werdykty: `PASS`, `REWORK`, `BLOCKED`. Brak dostępu do kodu lub niejasny zakres może blokować ocenę implementacji, ale nie blokuje użytecznej oceny dostarczonej rekomendacji. Wyraźnie nazwij tę różnicę.

Dla ustaleń używaj stabilnych ID w ramach review, np. `R03-01`. Zapisz wymaganie, obserwację, dowód, wpływ, znaczenie dla odbioru oraz rekomendację: kod / specyfikacja / oba / brakujące dowody. Każdemu ustaleniu nadaj jedną dyspozycję: blocker odbioru (wykazane naruszenie wymagania lub brak dowodu koniecznego do odbioru), uwaga nieblokująca albo osobne zadanie poza zakresem. Blocker musi wskazywać wymaganie, dowód i skutek dla celu użytkownika. Hipotetyczne ryzyko uzasadnia ograniczenie twierdzenia lub konkretne sprawdzenie, nie samoistną nową bramkę. Nie zamieniaj preferencji stylistycznej w blocker ani niespełnionego kryterium odbioru w osobne zadanie bez uprawnionej zmiany zakresu. Pokrycie kryteriów: met / unmet / unverified z dowodem; wykorzystaj istniejącą macierz odbioru, jeśli jest.

Jedna faza może prowadzić jeden rejestr ustaleń w istniejącym pliku review. Kolejne korekty dopisują datowany wpis z wersją wejścia, otwartymi ID, wynikiem sprawdzenia i nowymi istotnymi findingami; nie nadpisują poprzednich ocen. Zamknięte ID sprawdzaj ponownie tylko przy konkretnej regresji lub zmianie unieważniającej dowód. Nowa faza lub istotnie inny zakres uzasadnia nowy plik, sama następna runda nie.

Decyzja wskazuje review i jego wersję, przyjęte/odrzucone ustalenia z krótkim powodem, zmiany dokumentów/kodu, wykonawcze taski lub instrukcje oraz warunki ponownego sprawdzenia. Jest jednocześnie planem poprawek — nie twórz jeszcze jednego dokumentu powtarzającego jej treść. Zapisz kto i na jakiej podstawie zatwierdził decyzję. Nie przedstawiaj własnej rekomendacji jako zgody użytkownika.

Poprawki przywracające uzgodnione zachowanie mieszczą się w zleceniu implementacji całego featura, chyba że użytkownik zawęził zakres. Wykonuj je lokalnie, odwołując się do ustaleń review i istniejącej zgody, a następnie sprawdzaj zmieniony zakres i związane regresje. Przy dwóch kolejnych rundach bez postępu nad tym samym istotnym problemem pokaż przyczynę impasu i konkretną decyzję potrzebną do kontynuacji; użytkownik może ustalić inny budżet. To nie jest automatyczny limit dwóch review całego featura ani powód do zatrzymania skutecznych poprawek. Niezależnie od postępu, przy trzecim sprawdzaniu tego samego problemu w danej fazie zrób krótki krok wstecz: jakie istotne wymaganie pozostaje niespełnione, jaki jest dowód i czy prostsze podejście usunie klasę problemów? Powiązane ID mogą opisywać ten sam problem; zmiana fazy lub nowy defekt nie jest automatycznie powtórzeniem. Rozważ uproszczenie wcześniej, gdy jest oczywiste. Ten krok nie wymaga nowego dokumentu ani pytania, nie ogranicza liczby napraw i nie pozwala zaakceptować błędu. Zwykły wybór techniczny podejmij w istniejącej zgodzie; materialną zmianę wymagań uzgodnij. Odnotuj tylko istotny wynik w bieżącym review lub ledgerze. Zachowaj jawne limity prób/kosztów. Nowe wybory produktowe eskaluj, kontynuując niezależną, dozwoloną pracę.

## Feature z eksperymentami i kolejnymi falami

Ta sekcja dotyczy prac, w których pomiar decyduje o dalszym projekcie. Utrzymuj jeden brief celu i stosuj te same skille dla kolejnych fal. `feature-plan` konkretyzuje najbliższą falę, a dalsze opisuje przez pytania, wymagane wejścia i outputy. Nie wymagać szczegółowego backlogu ani wybranego algorytmu dla zakresu zależnego od nieznanych jeszcze wyników. Wyniki poprzedniej fali stają się wersjonowanym wejściem do ponownego planowania; nie zastępują samodzielnie decyzji.

Przed wykonaniem fali ustal hipotezę/pytanie, warunki i porównanie, wersje narzędzi oraz danych, główną metrykę, sposób oceny niepewności, podział eksploracja/potwierdzenie, budżet i regułę zatrzymania. Zakres może obejmować adaptacyjny dobór kolejnych batchy w ustalonych granicach. Zatwierdzenie takiej fali wystarcza do jej wykonania bez ponownej zgody przed każdym batchem; nowa decyzja jest potrzebna przy istotnym wyjściu poza ten zakres, zgodnie z istniejącą autoryzacją.

Ledger rejestruje wykonanie, koszty, błędy, odstępstwa i odnośniki do wyników. Raport opisuje metodę, pokrycie, wielkość efektu, niepewność i ograniczenia; rekomendację dalszego kroku oznacza jako rekomendację. Duże dane przechowuj poza katalogiem featura, wskazując trwałą lokalizację, wersję/hash i sposób analizy. Nie twórz osobnego `handoff.md` lub rejestru decyzji, jeśli powielałby ledger, raport, `feature.json` lub `decisions/`.

Do review wykonanej fali użyj istniejącego trybu `implementation` ze wskazanym zakresem eksperymentalnym; dla projektu pomiaru użyj `plan` albo `contracts`, zgodnie z jego rolą. Reviewer bada metodę, dane i analizę potrzebne do oceny wyniku oraz kod harnessu/modelu w zakresie, na którym ten wynik się opiera. Niezmieniony kod można wskazać wersją i udostępnić potrzebne fragmenty. Sam ledger ani same przechodzące testy nie dowodzą poprawności wniosku eksperymentalnego. Przy ograniczonym dostępie jawnie zawęź werdykt.

Oddziel trzy fakty: poprawność wykonania, wynik hipotezy oraz decyzję o dalszej pracy. Poprawnie wykonany eksperyment z wynikiem negatywnym lub nierozstrzygniętym może otrzymać `PASS`. `feature-decide` osobno rozstrzyga, czy kontynuować, uprościć, powtórzyć wskazany zakres czy zatrzymać kierunek. Ukończenie taska badawczego nie oznacza realizacji celu produktowego. Przy zakończeniu badań bez wymaganej poprawy odnotuj brak spełnienia celu; nie oznaczaj featura jako `accepted`, chyba że użytkownik jawnie zmienił zakres odbioru. Nie dodawaj nowych statusów Yumi ani trybów eksportu wyłącznie dla badań.

Po przyjęciu wyników uruchom `feature-plan` dla następnej fali, a następnie review i decyzję w wymaganym zakresie. Fale oraz ich odbiór mogą być objęte wcześniejszą delegacją; nie dodawaj nowych bramek zgody. Przy każdym powrocie aktualizuj kanoniczny projekt/taski, zachowując wcześniejsze dowody, review i decyzje.

## Równoległość i odbiór

Planner oddziela kontekst (`relations`) od faktycznych zależności wykonania, zgodnie z realną semantyką Yumi. Nie zakładaj, że każda relacja blokuje zadanie. Sprawdź lokalne instrukcje i istniejące taski; nie wymyślaj komend Yumi ani pól, których system nie obsługuje.

Zadania projektowe mogą poprzedzać implementację. Ich rezultat wymaga review w miejscach wskazanych przez projekt; nie trzeba zamrażać wszystkich szczegółów zanim wolno zacząć taki task. Dalsze taski mogą używać zaakceptowanych fixtures, lecz odbiór integracji wymaga rzeczywistych komponentów.

Koordynator wyznacza niezależne zakresy i integratora. Przy autoryzowanej pracy równoległej: osobne worktree i ledger per task, uzgodnione interfejsy, kolejność zmian współdzielonych plików, bez współdzielonych migracji czy usług testowych powodujących kolizje. Agenty nie nadpisują wspólnego indeksu — jego aktualizację wykonuje koordynator. Każdy subagent dostaje ID taska, wejścia, granice i oczekiwany handoff. Zgoda na workflow sama nie wymaga tworzenia subagentów w każdej fazie.

Feature kończy się po potwierdzeniu kryteriów na zintegrowanym kodzie, rozliczeniu istotnych ustaleń i wymaganych decyzjach/odbiorach. Po poprawkach badaj ich zakres i związane regresje; nie uruchamiaj bez powodu całego procesu od nowa. Zmiany dokumentów muszą trafić do aktualnych dokumentów kanonicznych, a nie pozostać wyłącznie w pliku decyzji.

## Wykonanie przez bridge: koordynator i rundy Claude’a

Gdy koordynator (manager w Codexie) ma narzędzia MCP bridge’a `bridge_feature_*`, implementację wykonują rundy Claude Code w jednej sesji przypisanej do featura. Procedura koordynatora jest w `<package>/skills/feature-execute/references/bridge-loop.md`, zasady wykonawcy w sekcji „Bridge round executor” skilla `feature-execute`. Pozostałe zasady tego przewodnika obowiązują bez zmian.

- Runda to jawny kontrakt: taski, obowiązująca autoryzacja, ustalenia review do poprawy, zakres zapisu, weryfikacja, ścieżka ledgera i pełne SHA bazy. Po `DONE` każda poprawka lub kolejny task to nowa runda w tej samej sesji; task `BLOCKED` wznawia się istniejącym recovery z wiadomością koordynatora, bez zastępczego taska.
- Wykonawca kończy rundę ledgerem i lokalnym commitem w granicach autoryzacji. Dostawą są te commity: pierwsza linia podsumowania `DELIVERY=local-v1 BASE=… HEAD=… LEDGER=… OUTCOME=… WORKTREE=…` wskazuje pełne SHA bazy z kontraktu i dostarczonego head. Koordynator sprawdza w Git bazę, pochodzenie, zakres zapisu każdego commita, ledger i niecommitowane zmiany (zastane oddzielnie od niedokończonej pracy wykonawcy, która wyklucza `COMPLETE`), po czym recenzuje dokładnie dostarczony SHA, a późniejszy dryf integracji opisuje osobno. Procedura: `<package>/skills/feature-execute/references/local-delivery.md`. ZIP rundy powstaje tylko wtedy, gdy wymaga go jej kontrakt (np. kontrakty wydane pod wcześniejszym runtime'em); wtedy koordynator dodatkowo uruchamia `verify`.
- Kanały są rozdzielone. Zwykłe wiadomości koordynatora do użytkownika i pytania do użytkownika nie trafiają do Claude’a; bridge niczego nie dokleja. Pytanie blokujące koordynator zapisuje przez `bridge_feature_wait_user` i pokazuje użytkownikowi. Zapis odpowiedzi nie uruchamia wykonawcy; koordynator przekazuje potrzebną decyzję jawnie w kontrakcie następnej rundy albo w wiadomości recovery.
- `COMPLETE` wykonawcy, werdykt review i akceptacja użytkownika to osobne fakty. `bridge_feature_accept` zamyka dalsze rundy, więc koordynator wywołuje go dopiero po akceptacji zapisanej w `decisions/`.
- Obowiązuje zwykła reguła impasu: dwie kolejne rundy (lub dwa kolejne wznowienia) bez postępu nad tym samym istotnym problemem prowadzą do pytania; poza jawnymi budżetami nie ma limitu liczby rund.
- Pytanie blokujące zamraża wszystkie rundy i recovery featura do zapisu odpowiedzi; najpierw kończ rundy od niego niezależne.
- Po przerwaniu, timeoucie lub restarcie koordynator najpierw odczytuje stan (`bridge_feature_get`); ponawia tę samą operację tym samym kluczem, a nową rundę uruchamia tylko po review poprzedniej.

`feature.json` koordynatora może zawierać `"bridge": {"feature_id": "...", "parent_task_id": "..."}`, aby inny agent odnalazł stan bridge’a bez historii rozmowy.

## Opcjonalna wymiana ZIP-ów

ZIP jest potrzebny tylko odbiorcy bez dostępu do repozytorium i wskazanych commitów albo na jawne żądanie; odbiorca z takim dostępem, także zewnętrzny reviewer, dostaje commity i dokumenty w repo. Wymiana odbywa się w przestrzeni nazw danego worktree: `~/tmp/bridge-exchange/ws_<16 hex>/` z katalogami `packages/`, `incoming/` i `staging/`. Klucz to pierwsze 16 znaków SHA-256(kanoniczny root worktree + NUL + kanoniczny katalog git tego worktree), więc dwa worktree jednego repozytorium nie kolidują nawet przy identycznych nazwach featura, celu i rundy; to nigdy nie jest nazwa brancha, ID featura ani sesji. Ścieżkę wypisuje `feature_exchange.py namespace --repo <ścieżka>`; wybór jest tylko do odczytu i niczego nie przejmuje. Eksportuj przez `--name <plik>.zip`, staging przez `--stage-name <nazwa>`; jawne `--output`/`--staging` pozostają dosłowne. Zwrotkę pobraną gdzie indziej skopiuj najpierw do `incoming/` tej przestrzeni. Staging pozostaje nowym katalogiem poza repo, a oryginalne ZIP-y nie są nadpisywane. Dawne płaskie przykłady `~/tmp/<feature>-<cel>-<n>.zip` w historycznych ledgerach i review opisują ówczesny stan i nie są przepisywane.

Skill `feature-exchange` zawiera skrypt Python 3.9+ bez dodatkowych zależności. Eksport zawsze obejmuje pełny katalog featura, zarejestrowane taski, ten przewodnik i jawny kontekst. Manifest zapisuje SHA-256 każdego pliku, HEAD repo, cel i granice materiału. Opcjonalny zakres kodu pochodzi z commitów; dokumenty pochodzą z bieżących plików. To rozróżnienie jest jawne.

Do review planu używaj paczki dokumentów. Do review implementacji dołącz zakres kodu i potrzebny kontekst; sam ledger nie wystarcza do niezależnej oceny kodu. Duże/prywatne materiały zastępuj odpowiednimi małymi dowodami albo uprawnionymi odnośnikami i opisz ograniczenie.

Zachowaj oryginalny ZIP. Reviewer zwracający dokumenty zachowuje jego `exchange-manifest.json` bez zmian; edytuje pliki w ich ścieżkach i może dodawać nowe review/decyzje wewnątrz featura. Manifest opisuje wersję wejściową, nie jest podpisem nowych treści. Skrypt porównuje oryginał, zwrotkę i lokalne pliki, wskazuje konflikty i przygotowuje staging poza repo. Nie stosuje zmian automatycznie. `feature-exchange` następnie nanosi uprawnione poprawki; rozbieżności scala, a nie nadpisuje. Brak pliku w ZIP-ie nigdy nie oznacza zgody na jego usunięcie.

Domyślnie są dwa przekazania do użytkownika: projekt i taski przed zleceniem implementacji, a następnie zintegrowany wynik z oryginalnymi ledgerami, niezależnym lokalnym review, dowodami i executive summary do odbioru. Przy dostępie do repozytorium przekazaniem jest krótki handoff wskazujący commity, wyniki, ograniczenia, review i następny krok; ZIP tylko bez takiego dostępu lub na żądanie. Rzeczywisty odbiór użytkownika pozostaje wymagany. Osobne przekazanie kontraktów występuje tylko wtedy, gdy wymaga go konkretna nierozstrzygnięta decyzja lub uzgodniona bramka zewnętrzna. Lokalne review tasków i poprawki nie tworzą kolejnych obowiązkowych wymian. Jeśli końcowy odbiór zatwierdzi poprawki, wykonaj cały zatwierdzony zakres i lokalne ponowne review przed następnym przekazaniem. Jawna prośba użytkownika o eksport w innym momencie nadal obowiązuje.
