# Review 04 — integracja hcom ze skillami

## Etap W21-03 — 2026-11-10

**PASS dla W21-03 na 94074d8bdcb04af9fe3e8e0ce4ffd85001150d9b.** Nie stwierdzono
wymaganych poprawek ani nowych uwag nieblokujących. Implementacja realizuje zakres
decyzji05 i planu03: jawny transport, wspólne zasady dostawy Git, prywatny zapis
intencji oraz instrukcje koordynatora/wykonawcy w nowym bundle.

**Rozszerzony feature nie jest jeszcze zaliczony.** W21-04 musi wykazać rzeczywiste
wejście przez nowy skill, commity/ledger/raport, korektę i odczyt stanu bez resend.
Wyniki trwających szerszych suite także trzeba rozliczyć w końcowym review.
Techniczny PASS tego etapu nie zastępuje tych dowodów ani Gate 2.

### Wejścia i niezależność

- Dostawa94074d8, decyzja05, plan d6263ed i review03; AC-07–10 briefu.
- Obejrzano canonical feature-execute/feature-flow, hcom-loop, round-executor,
  local-delivery, hcom_state.py, jego testy, guide, source preamble oraz generację
  i manifest kandydata. Skille produktu nie zastępują instrukcji niniejszego review.
- INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74
- Reviewer nie pisał ocenianych instrukcji/helpera. Odczytał ledger po źródłach.
  Nie uruchamiał hcom/modeli/MCP. Jedyny zapis produktu review to ten plik.

### Ustalenia

**Transport i rola.** Oba wejścia zachowują execution.transport, nie traktują
błędu Bridge jako wyboru hcom i wymagają rozliczenia aktywnego workstreamu przed
migracją. Guide zawęża automatyczną ścieżkę Bridge do braku jawnego hcom.
Preamble rozpoznaje delegowanego wykonawcę przed zwykłym resolve; wykonawca
weryfikuje przekazany bundle i przechodzi do ograniczonej sekcji, bez adopt,
koordynacji, delegacji i samodzielnego następnego taska. Wspólny round-executor
zachowuje dotychczasowe ograniczenia Bridge.

**Dokładny zestaw instrukcji.** Koordynator najpierw wykonuje zwykły resolve,
sprawdza identity i wybiera `<bundle.root>/claude`. Kontrakt przenosi bundle,
worker_root i identity; worker weryfikuje je przed pracą oraz sprawdza digest
kontraktu. Bieżący workflow.mjs obsługuje podane `verify --bundle --identity --json`.
Brak referencji hcom w wybranym starym zestawie nie powoduje czytania latest.
Jawny hcom nie znosi istniejącego pinu/locka. Root i identity helpera nie stanowią
samodzielnego dowodu integralności: ten obowiązek pozostaje w jawnej instrukcji
verify, co odpowiada minimalnemu zakresowi helpera.

**Niepewna wysyłka i kontynuacja.** Init daje launch_permitted tylko przy świeżym
zapisie. Prepare atomowo zapisuje snapshot/digest kontraktu przed przyznaniem
dispatch_permitted; ponowna runda o tym numerze jest odrzucona. Status nigdy nie
daje grantu. Sent przyjmuje ponownie ten sam event_id, a odmienny odrzuca.
Instrukcja po przerwaniu wymaga sprawdzenia historii i powiązania sesji, a nie
ponownego send lub nowej rundy zastępującej niepewną pracę. Kolejne prepare wymaga
rozliczonej accepted/rework; blocked/unknown nie przechodzi automatycznie dalej.
Nie jest to pełne recovery i dokumenty tego nie obiecują.

**Odbiór.** Report jest skorelowany z feature/task/round/workflow i dokładnym
report_path; pierwsza linia musi wskazać base i ledger danego kontraktu.
Accepted wymaga COMPLETE, null blocker i zaliczonych wszystkich checks kontraktu.
Wcześniejszego receipt nie da się nadpisać. Helper nie weryfikuje Git ani realnej
jakości testów; hcom-loop wyraźnie wymaga osobnego sprawdzenia zakresu każdego
commita, nowego ledgera, dirt, rzeczywistych testów oraz niezależnego review.
Zapis receipt jest decyzją koordynatora, nie automatyczną akceptacją produktu.

**Zakres i pakiety.** Helper pozostaje księgowaniem standard-library: brak
uruchamiania hcom/modeli/Git writes. Lock i atomic replace chronią zwykły zapis,
nie tworzą nowego schedulera. Workflow1.1.0 jest kandydatem o tożsamości
sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb.
Rejestr opublikowanego1.0.0, źródła using-bridge i obie paczki bridge pozostają
niezmienione. Nowe refs/helper są we wszystkich wymaganych wariantach bundle.

### Niezależna walidacja

- `PYTHONDONTWRITEBYTECODE=1 TMPDIR=/private/tmp python3 -m unittest discover
  -s tests -p test_hcom_state.py -v`: **13 PASS**. Przypadki obejmują odmowy
  obcej sesji/workspace/workflow, ponownego prepare, starego raportu, fałszywego
  accepted, nadpisania receipt i wznowienie przy niepewnym send.
- `TMPDIR=/private/tmp node scripts/plugin-packages/generate.mjs --check
  --component all`: **PASS**, źródła i wygenerowane drzewa zgodne.
- Porównanie zakresu dostawy: registry oraz role/paczki Bridge niezmienione.
  `git diff --check 94074d8^..94074d8`: **PASS**.
- Składnia hcom send --json i globalnego --name ma odpowiedniki w przypiętym
  źródle0.7.31. Nie wykonywano żadnej komendy hcom ani forward-testu z modelem.
- 36 local-delivery i build PASS to dowody wykonawcy z ledgera, nie powtórzone
  tu testy. Szersze suite były w toku; zgłoszony problem aliasu TMPDIR i brak
  PyYAML nie zostały potraktowane jako zaliczone kontrole.

### Pokrycie etapu

AC-07: routing i trwały wybór zaimplementowane w instrukcjach; zastosowanie przez
realnego koordynatora wymaga W21-04. AC-08: kontrakt, dokładne instrukcje workerowi
i receipt Git przygotowane; realna dostawa nowych skilli nadal pending.
AC-09: helper i procedura bez resend sprawdzone bezmodelowo; realny ponowny odczyt
koordynatora pozostaje pending. AC-10: dystrybucja PASS i brak zmian Bridge,
pilot od skilla oraz końcowe wyniki regresji nadal do rozliczenia.

Nie otwarto nowych findingów. Niezależny review całego rozszerzonego wyniku należy
dopisać tutaj po W21-04, zachowując tę ocenę etapową.

## W21-04 i korekta fixture — 2026-11-10

**PASS dla realnego pilota rozszerzenia i korekty fixture** na
0d2cffca496a45b9e05166f6f9c1b675c703344f, obejmującego c5a1cc61fb9c1506a844db2da3d00981d871178c.
Funkcjonalne AC-07–10 są wykazane w uzgodnionym minimalnym zakresie. Nie znaleziono
defektu skilla/helpera ani błędnej interpretacji pilota wymagającej poprawki.
**Końcowe rozliczenie szerszej regresji pozostaje pending**: zakończony npm run
ma 27 failed / 755 passed / 2 skipped w 56 plikach. Nie oznaczono go PASS.
Przyczyny i celowane ponowienia wymagają oddzielnego dopisku przed końcową
rekomendacją odbioru całego rozszerzenia. Gate 2 pozostaje otwarta.

### Niezależnie sprawdzone dowody pilota

Reviewer odczytał opublikowane evidence/skill-pilot, ledger W21-04 oraz wskazane
prywatne pliki zakończonej próby: run/state, trzy snapshoty sesji, historię, zapis
odczytu przed ack i recovered-sent, receipts, artefakty obu rund i stopped.
Odczytał również obiekty Git źródłowego repo pilota. Nie czytał transkryptów,
nie uruchamiał hcom/modelu ani mutacji MCP. Prywatne ID/ścieżki nie są kopiowane.

- Oba requesty6/34 odsyłają do nowego feature-execute w dokładnym worker_root,
  jego roli executor oraz właściwego digestu kontraktu. Nie używają starego
  worker.md. Publikowane kontrakty różnią się od oryginałów tylko placeholderami
  workspace/workflow_bundle/worker_root; hashe oryginałów zgadzają się ze stanem
  i ledgerami. W obu dostarczonych HEAD feature ma transport hcom oraz lock
  przypięty do kandydata1.1.0 o identity2205a80f5109… z etapu W21-03.
- Niezależne, odczytowe `workflow.mjs verify --bundle --identity` dla dokładnego
  wybranego bundle: PASS. Ledgery wykonawcy podają verify oraz zgodną tożsamość;
  bez transkryptu reviewer nie rekonstruuje każdej komendy modelu. Zgodność
  przekazanego zestawu, jego bytes i śladów dostawy jest sprawdzona.
- Session.json, session-r2 i session-final mają tę samą nazwę, native session_id
  i katalog co binding. Nie stwierdzono zamiany wykonawcy. Stopped potwierdza
  zwykłe zakończenie exit:prompt_input_exit; repo pilota pozostaje czyste.
- Dla obu BASE..HEAD sprawdzono ancestry, brak merge, zakres endpoint i każdego
  commita, zgodność changed_scope oraz dodanie nowego ledgera. Druga runda
  zachowuje wcześniejszy ledger. Publikowane words.py/tests są bajtowo zgodne
  z obiektami Git dokładnych HEAD; ledgery po jedynej redakcji nazwy workera
  odpowiadają commitom. Raporty odpowiadają kopiom operatora i receipt w stanie.
- Runda1 ma receipt=rework, runda2=accepted. Korekta to rzeczywisty test Unicode
  whitespace i opis str.split; logika oraz sześć wcześniejszych testów zachowane.
  Nie przedstawiono poprawy pokrycia jako nieistniejącego błędu funkcjonalnego.
- Resume-before-sent zawiera już prepared contract, brak send_event_id oraz
  launch_permitted=false i dispatch_permitted=false. Historia zawiera dokładnie
  request6 dla pierwszej rundy; recovered-sent zapisuje ten sam ID bez nowego
  grantu. Pełna historia ma dwa task requesty6/34 i wyniki31/50. Jest to realny
  send i ponowny odczyt w nowym procesie helpera, nie restart/crash klienta.
- Czasy i recipient_count observations zgadzają się z historią. Utrzymano
  pozostały budżet: druga próba F-W21, dwa nowe task prompty, łącznie2/4.
  Obie rundy mieszczą się w10 minutach, nowa część w30 minutach. Licznik13 zgód
  plus trust pozostaje zapisem operatora; koszt i czas aktywnej obsługi są
  jawnie nieznane. Broadcast jest odbierany przez historię, nie inbox Codexa.

### Walidacja i zakres twierdzeń

- Niezależne unittest na publikowanych plikach, wcześniej porównanych z dokładnymi
  obiektami Git: **6 PASS** w rundzie1 i **7 PASS** w rundzie2. Nie uruchomiono
  ponownie modelu. To sprawdzenie dostarczonych artefaktów.
- Fixture c5a1cc6 rejestruje w syntetycznym registry rzeczywistą wersję źródła
  zamiast stałej1.0.0. Wciąż sprawdza VERSION_REUSED, odmowę przed zapisem oraz
  działanie po usunięciu wpisu. Nie osłabia immutability. Niezależny
  `IndependentGeneration.test_a_registered_version_with_other_bytes_is_refused`
  z TMPDIR=/private/tmp: **PASS**.
- Checker dokumentacji: **299 Markdown**, zero broken_links i absolute_paths;
  tylko wcześniejszy loose substring w F-W19. Diff-check94074d8..0d2cffc: PASS.
- Zachowane dowody wykonawcy: pełny Python miał273 PASS i jeden błąd poprawionego
  fixture, oba quick_validate PASS po użyciu dostępnego PyYAML. Pilot tooling
  ma128 PASS /2 skip /1 odmowę macOS dotyczącą /proc. Tych zbiorczych przebiegów
  reviewer nie powtarzał i nie przedstawia ich jako niezależnego pełnego PASS.
- Odczytany npm log ma także błędy setup/doctor/profile, obok zgłoszonych
  aliasów ścieżek, fixture i stderr. Kod runtime'u/instalatora/testów npm nie
  został zmieniony przez rozszerzenie, ale samo to nie dowodzi braku regresji
  generowanych zasobów. Weryfikacja hcom i jego pakietów jest pozytywna;
  triage/ponowienia npm muszą rozliczyć pozostałe błędy osobno.

| Kryterium | Ocena w świetle W21-04 |
| --- | --- |
| AC-07 | met: zapisany transport hcom zachowany, requesty i state korzystają z niego; flow routing oceniony w instrukcjach, nie oddzielnym modelowym flow |
| AC-08 | met: ten sam zweryfikowany bundle, dwie dostawy Git z nowymi ledgerami/reportami oraz niezależnym receipt |
| AC-09 | met: realny odczyt prepared state po send przed ack, jeden request, rozpoznanie istniejącego eventu bez resend i bez zamiany sesji |
| AC-10 | ścieżka produktu met: wygenerowane zasoby, realny feature-execute, korekta i odczyt stanu; szeroka regresja zwykłego Bridge nadal wymaga rozliczenia opisanego powyżej |

Pojedyncza próba wspiera użycie ograniczonej integracji, nie gwarancję recovery,
niezawodności, niższego kosztu ani całkowicie samodzielnego działania. Rozróżnienie
realnego feature-execute od sprawdzenia routingu feature-flow jest jawne i zgodne
z planem jednego modelowego pilota. Brak potrzeby kolejnego modelu do powtarzania
tych samych dowodów; pozostała praca to wyjaśnienie regresji bezmodelowej.

## Końcowe rozliczenie regresji i werdykt — 2026-11-10

**PASS dla uzgodnionego rozszerzenia F-W21; rekomendacja Gate 2.** Ten wpis
zamyka wcześniejsze pending dotyczące rozliczenia regresji, zachowując wyniki
nieudanych przebiegów. Produkt94074d8, fixture c5a1cc6, pilot0d2cffc i zapis
walidacji0b02334dab519d42e4d197e03f7195e070fb5892 są ocenionymi wejściami.
Nie pozostały wymagane poprawki w zakresie featura. Akceptacja użytkownika,
publikacja i instalacja nie wynikają automatycznie z tego PASS.

Reviewer odczytał pełny npm log, focused log oraz końcowy ledger W21-03/03.
Porównanie nazw testów niezależnie potwierdza: **25 z pierwotnych27 porażek
przechodzi w powtórce** po kanonicznym TMPDIR i poprawnym Pythonie w PATH.
Grupowa powtórka ma30 PASS /1 FAIL /127 odfiltrowanych; dodatkowe pięć PASS
to sąsiednie przypadki. Nie sumujemy tych wyników jako jednego zielonego suite.

Pozostały trzy jawne ograniczenia istniejących testów na macOS:

1. **Stderr fixture.** Reviewer niezależnie uruchomił wyłącznie skryptowaną
   fake-claude-cli, bez adaptera i modelu: z żądanych100001 bajtów stderr otrzymał
   65536, exit3, bez TAIL-MARK. Źródło wykonuje write i natychmiast process.exit,
   a komentarz zakłada synchroniczne pipe Linuxa. To wystarczająco izoluje błąd
   założenia fixture od zachowania adaptera/hcom; test nadal pozostaje FAIL.
2. **R2-06 i limit pliku.** Focused log pokazuje poprawnie zakończony eksport
   wielkości13566 bajtów z jawnym gap backup_failed. Źródło testu ustawia
   ulimit -f20; zapisany pomiar tego shella daje20480 bajtów. Ten eksport nie
   osiąga progu wymuszonego błędu, więc ten przebieg nie testuje oczekiwanej
   odmowy zapisu. Nie uznajemy go za dowód poprawności obsługi pełnego dysku
   ani za regresję hcom. Eksporter i test nie zostały tu zmienione.
3. **Quiescence tools/pilot.** Pierwotny log miał brak tomllib; odczytany teraz
   osobny rerun na właściwym Pythonie kończy się odmową „no other process has
   the target file open”. Niezmienione open_by zwraca unknown bez /proc, co
   odpowiada tej odmowie na macOS. Zachowano fail-closed guard; nie oznaczono
   niedostępnej kontroli jako PASS i nie osłabiono jej dla uzyskania zieleni.

Porównanie f836899..HEAD potwierdza brak zmian tych fixture'ów, adaptera,
eksportera i narzędzia quiescence. Powyższe ograniczenia są rozliczone poza
zakresem F-W21, nie są odroczonymi niespełnionymi wymaganiami hcom. Naprawa ich
przenośności wymaga osobnego zakresu, nie kolejnego modelowego pilota tego featura.

Dla AC-10 zachowanie zwykłego Bridge ocenia się na podstawie niezmienionych
runtime/role packages, przechodzących kontroli pakietów/local-delivery oraz
rozliczonej regresji. Nie znaleziono naruszenia tego wymagania. W połączeniu
z wcześniejszym review pierwotnego MVP i rzeczywistym W21-04, **AC-01–10 są
spełnione w uzgodnionym zakresie**. Nadal nie ma twierdzenia o pełnym zielonym
npm/pilot suite, pełnym modelowym przebiegu feature-flow, crash recovery,
niezawodności populacyjnej ani przewadze nad Bridge'em. Wynik jest gotowy
do decyzji użytkownika o odbiorze ograniczonej integracji.

### Korekta metadanych klienta — 2026-11-10

Sprawdzono2656464e3c38808afd71412e56cd491ccba69b96 oraz lokalny client-version.json.
Pilot W21-04 używał **Claude2.1.322**, nie odziedziczonej z wcześniejszej próby
wartości2.1.321. Lokalny wyciąg podaje wyłącznie2.1.322 z top-level version
metadanych zakończonego workera i zgodne CLI sprawdzone po próbie. Reviewer
porównał ten wyciąg z poprawionym summary/observations; nie czytał transkryptu.
Korekta dotyczy wyłącznie pochodzenia dowodu wersji, bez zmian produktu, bundle
czy zachowania. Historyczny pierwszy pilot pozostaje bez zmian. **PASS utrzymany.**
