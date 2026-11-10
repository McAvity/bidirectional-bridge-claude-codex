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
