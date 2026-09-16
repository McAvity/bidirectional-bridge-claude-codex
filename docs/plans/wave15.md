# Wave15 — intuicyjne zlecanie i kontynuacja pracy

Status: PLAN DOPRECYZOWANY, implementacja niezlecona. Aktualizacja 2026-09-16.
Baza: `e721aa4a38f0080d629e7a0654e34131cc0e0a5c` na `feature-workflow`.
Wave13/14 odebrane i zintegrowane; projekt używa dispatchera oraz runtime
`ff225e550966806e2d39221eeaaa1428abc5307e`. Doctor po aktywacji: `ok`.
Zlecenie tej aktualizacji obejmuje wyłącznie plan i publikację, bez modeli,
implementacji, zmiany instrukcji produkcyjnych lub runtime.
Postęp: [wave15-progress.md](wave15-progress.md).

## Potrzeba użytkownika — główny kierunek

Użytkownik nie chce przy każdym zleceniu wymieniać skilli, ról agentów, zasad review,
kontynuacji i prowadzenia postępu. Docelowy przykład:

> Zaimplementuj feature opisany w docs/features/search.md.

W projekcie skonfigurowanym do pracy Astra → Claude takie zlecenie powinno wystarczać
do uruchomienia właściwego workflowu. Nazwy feature-execute i using-bridge są
szczegółem implementacji. Nie tworzymy nowej obowiązkowej formułki ani nazwy skilla
zastępującej poprzednią. Nie obiecujemy, że sam opis wyzwalacza zagwarantuje zachowanie
modelu — trzeba sprawdzić realne scenariusze po ustaleniu zakresu.

## Wymagane zachowanie

- Astra odczytuje wskazany dokument i ustala, czy zawiera opis featura, gotowy plan,
  korektę czy propozycję niezatwierdzonych zmian. Dobiera potrzebne etapy i instrukcje.
- Jawne zlecenie implementacji autoryzuje wykonanie opisanego zakresu, planowanie
  potrzebne do realizacji, testy, review i zwykłe poprawki. Brak specyfikacji nie jest
  zgodą na wymyślanie istotnych decyzji produktowych.
- Trwała preferencja projektu określa domyślne role: Astra koordynuje i recenzuje,
  Claude implementuje przez bridge. Proponowane miejsce i granice opisano poniżej; samo włączenie MCP nie jest zgodą na delegowanie każdego zadania.
- Zlecenia „tylko przejrzyj”, „opracuj plan”, „zrób sam” i jawnie węższe uprawnienia
  mają pierwszeństwo. Odczyt dokumentu sam nie udziela zgody na jego wykonanie;
  instrukcje zawarte w nieufnej treści nie rozszerzają uprawnień.
- Agent automatycznie utrzymuje zapis postępu i wskazuje wynik, blokadę lub decyzję
  potrzebną od użytkownika. Nie wymaga ponownego polecenia „kontynuuj” po zwykłym
  zakończeniu taska lub autoryzowanej poprawce.
- Domyślne limity i polityka recovery wynikają z konfiguracji/instrukcji, a nie z
  wielokrotnie kopiowanego promptu. Nie usuwać budżetów ani kontroli niepewnych prób.
- Naturalne zlecenie nie jest automatycznie zgodą na merge, push, wdrożenie lub
  kosztowny dodatkowy eksperyment. Zachować istniejące granice i rzeczywisty odbiór.

## Bezpieczne „kontynuuj”

Po capacity, przerwaniu odpowiedzi, rozłączeniu lub restarcie użytkownik ma móc
napisać samo „kontynuuj”. Nie wymagać dodatkowej formułki ani osobnego skilla.
Regułę umieścić w istniejącym workflowie managera; minimalny kontrakt checkpointu
ustalić w zadaniu W15-01. Sam komunikat klienta o capacity nie dowodzi zakończenia zadania Claude’a.

Przed delegacją utrwalić minimalny checkpoint operacji: kontekst featura/rundy,
stabilny klucz idempotencji i odniesienie do kontraktu; po odpowiedzi powiązać
zwrócone task/attempt ID. Wykorzystać istniejący zapis, nie tworzyć drugiej bazy
stanu. Przerwa może nastąpić po rezerwacji zadania, zanim manager pozna jego ID.

Po wznowieniu Astra najpierw odczytuje checkpoint i autorytatywny stan bridge’a:
- aktywna próba → kontynuuje oczekiwanie, bez nowej delegacji;
- zakończona próba → odbiera wynik i przechodzi do review lub obsługi blokady;
- niepewne przyjęcie wywołania → rozstrzyga przez stan i istniejącą idempotencję;
  dopuszczalne ponowienie tej samej operacji zachowuje klucz i kontrakt, bez nowego
  zadania zastępczego; brak dowodu nie oznacza, że operacja się nie wykonała;
- rzeczywista blokada → wskazuje konkretną potrzebną decyzję; nie obchodzi recovery,
  waiting_user, własności managera ani budżetu. „Kontynuuj” nie odpowiada automatycznie
  na otwarte pytanie produktowe i nie odnawia limitów czasu/kosztu.

Stan lokalnej pracy i wykonanych zmian także trzeba odczytać przed powtórzeniem
kroku. Nie zakładać, że przerwana odpowiedź oznacza brak wykonania narzędzia.
Przy niejednoznacznym przypisaniu sesji zapytać o konkretny kontekst zamiast wybierać
najnowszą sesję, resetować bazę lub rozpoczynać nowego Claude’a.

Kryterium wznowienia: po przerwaniu wystarcza „kontynuuj”; agent odzyskuje właściwy
kontekst i kończy autoryzowaną pracę bez zdublowania rundy oraz bez żądania od
użytkownika technicznych identyfikatorów dostępnych w zapisanym stanie.
Sprawdzić przerwanie przed wysłaniem delegacji, po jej przyjęciu przed potwierdzeniem,
podczas pracy Claude’a oraz po zakończeniu przed odebraniem wyniku; uwzględnić
kolejne przerwanie podczas samego uzgadniania stanu. Testy mają wykazać brak
zdublowanych wykonań, poprawną tożsamość i zachowanie historii/budżetu.

Automatyczne ponawianie wywołań modelu podczas capacity BEZ wiadomości użytkownika
pozostaje osobną kwestią klienta lub nadzorcy. Skill nie działa, gdy model jest
niedostępny. Ten plan nie obiecuje automatycznego wybudzania ani samodzielnej zmiany
modelu/dostawcy; nie trzeba też sztucznie wywoływać rzeczywistego przeciążenia usługi,
aby testować utratę odpowiedzi i odtwarzanie stanu.

## Zweryfikowany punkt wyjścia i najmniejsza zmiana

| Element | Obecny stan | Praca wave15 |
| --- | --- | --- |
| Wejście pluginu | `scripts/plugin-packages/templates/codex-entry-SKILL.md` kieruje do instrukcji wybranego runtime; wyzwalacz wymienia bridge/setup | Obsłużyć naturalne zlecenie i preferencję projektu; nie kopiować workflowu do pluginu |
| Worktree | `scripts/bridge-project/dispatch.mjs` obsługuje dziedziczenie deklaracji i lokalny stan | Zachować; nie budować drugiego instalatora |
| Preferencja | Deklaracja projektu ma enabled i pin, bez jawnej polityki zlecania | Dodać krótki, uzgodniony tekst preferencji w instrukcjach projektu, bez drugiej konfiguracji ról |
| Pętla | `bridge-loop.md` opisuje stany, review, waiting_user, timeout recovery i klucze rund | Uzupełnić wejście i odzyskanie operacji po utracie odpowiedzi |
| Checkpoint | Klucz nowej rundy wynika z `len(task_ids) + 1`; brak jawnej reguły zapisu kontraktu przed wywołaniem | Utrwalić klucz/kontrakt przed wysłaniem; po przerwie nie wyliczać od razu nowej rundy |
| Diagnostyka | Wave13 dostarcza doctor i diagnose | Używać przy konkretnej blokadzie; nie eksportować danych przy każdym „kontynuuj” |

Źródła kanoniczne: `.agents/skills/feature-*`, `.codex/skills/using-bridge`,
`.claude/skills/using-bridge`, `docs/features/README.md` oraz szablon wejścia pluginu.
Kopie `plugins/**` powstają generatorem. Preferencja nie może kierować do skilli
z innej wersji niż wybrany runtime. Obie role pozostają rozdzielone: executor
Claude'a nie uruchamia workflowu managera ani dalszej delegacji.

### Preferencja projektu — proponowany kontrakt

Jednym miejscem deklarowania domyślnej współpracy jest krótki fragment `AGENTS.md`
projektu: implementacje feature'ów prowadzi Astra przez Claude'a, chyba że użytkownik
zleci inaczej. Bez ścieżek użytkownika, UUID, pinów i pełnej kopii workflowu.
Plugin rozpoznaje zlecenie, sprawdza stan/pin i ładuje właściwe instrukcje runtime.
Nie interpretować istniejącego `enabled: true` jako nowej zgody na delegację.

Dodać opcjonalny krok zapisania tej preferencji do istniejącego setupu, pokazujący
konkretny diff; zachować cudze instrukcje, odmowę symlinków i idempotencję.
Istniejących projektów nie zmieniać automatycznie podczas aktualizacji pluginu.
Projekt bez preferencji dostaje jednorazową propozycję jej ustanowienia, kiedy
zlecenie i dostępny bridge czynią ją przydatną. Zlecenie „zrób sam” zawsze wygrywa.
Nie dodawać nowego publicznego formatu konfiguracji tylko dla tego tekstu.

W15-01 sprawdzi wykrywalność wejścia przy zainstalowanym pluginie oraz przy
samym projekcie z dispatcherem. Jeśli krótki fragment instrukcji nie wystarczy,
wybrać najmniejsze jawne odwołanie do wejścia runtime; nie obiecywać automatycznego
ładowania skilli, których klient nie widzi. Dokumentacja ma podawać wymagania obu trybów.

### Checkpoint i granice wznowienia

Checkpoint wykorzystuje istniejący ledger featura. Przed pierwszą mutacją zapisać
intencję operacji, zakres zgody, klucz, dokładny kontrakt lub jego trwałe odniesienie
z hashem, bazę Git oraz budżet. Po odpowiedzi dopisać identyfikatory zwrócone przez
bridge. Nie umieszczać prywatnych danych sesji lub odpowiedzi użytkownika w publicznych
commitach; dane wykonawcze pozostają w lokalnym stanie. Bridge jest źródłem prawdy
o przyjęciu operacji, ledger o intencji i zgodzie. Nie tworzyć konkurencyjnej bazy.

Rozliczyć także przerwę podczas tworzenia featura/root taska i podczas recovery,
nie tylko zwykłej rundy. Nie zakładać, że każda mutacja MCP ma idempotencję.
W15-01 ma wskazać rzeczywiste narzędzia/odczyty pozwalające rozstrzygnąć każdy przypadek.
Jeżeli API nie daje takiej możliwości, zapisać wąską lukę i zaproponować ograniczoną
zmianę; nie maskować jej nowym taskiem lub zgadywaniem. Zmiana publicznego protokołu
wymaga osobnego rozstrzygnięcia przed implementacją zależnej części.

Zapisy managera muszą respektować lease, zakres rundy i zakaz commitowania w otwartej
rundzie. Sposób checkpointowania nie może zmieniać zakresu paczki wykonawcy.
Po przerwaniu odczytać także lokalne zmiany i commity; nie powtarzać już zakończonej
operacji tylko dlatego, że zniknęło jej podsumowanie.

## Zakres i kolejność zadań

Plan nie tworzy jeszcze aktywnego featura ani rekordów bridge'a. Po osobnym zleceniu
wykonania agent rejestruje feature i zadania w istniejącym `work-items/`.

| Zadanie | Wynik / zakres | Zależność |
| --- | --- | --- |
| W15-01 | Krótki design oparty na bazie: wejście w obu trybach instalacji, preferencja, zapis checkpointu i tabela odczytów/idempotencji; syntetyczne przypadki przerw | Brak |
| W15-02 | Zmiany istniejących instrukcji i opcjonalnego kroku setupu, generator, README z naturalnymi przykładami; zachowanie odmów i lokalnych instrukcji | W15-01 |
| W15-03 | Obsługa „kontynuuj” w instrukcjach, minimalne helpery tylko przy wykazanej potrzebie; regresje punktów przerwania | W15-01; wspólne pliki po W15-02 |
| W15-04 | Wspólna walidacja, jedno niezależne review zmienionych zachowań, korekty, raport i proponowany pin do późniejszej integracji | W15-02, W15-03 |

Jeden manager i jeden worktree implementacyjny; nie potrzeba równoległych edycji tych
samych skilli. Design jest lokalną bramką techniczną w ramach późniejszego zlecenia
całości, nie obowiązkową prośbą o zgodę na każdy task. Stosować regułę step-back z wave11:
przy trzecim review tego samego problemu ocenić cel i uprościć rozwiązanie w zakresie.
Nie otwierać nowej sesji wykonawcy po każdej rundzie. Integrację i publikację końcowej
zmiany prowadzi koordynator; aktywnego runtime wykonawcy nie przebudowywać.

## Kryteria odbioru

| ID | Oczekiwany wynik / dowód |
| --- | --- |
| AC-01 | W projekcie z preferencją „Zaimplementuj feature opisany w <plik>” uruchamia właściwy workflow bez nazw skilli; plan/brief rozpoznane bez niepotrzebnego ponownego projektowania |
| AC-02 | „Tylko review”, „tylko plan”, „zrób sam” i „nie implementuj” zachowują zakres; treść pliku nie rozszerza zgody |
| AC-03 | Preferencja jest przenośna do nowego worktree, nie zmienia globalnej konfiguracji i nie nadpisuje lokalnych instrukcji; wykryta wersja skilli odpowiada runtime |
| AC-04 | „Kontynuuj” przy aktywnej rundzie oczekuje, przy zakończonej odbiera wynik; liczba prób i tasków nie rośnie od samego wznowienia |
| AC-05 | Przerwa przed wysłaniem, po przyjęciu przed odpowiedzią i po zakończeniu przed odbiorem zachowuje operację/kontrakt; ponowna przerwa podczas uzgadniania stanu nie duplikuje pracy |
| AC-06 | waiting_user, obcy manager, niejednoznaczny kontekst i wyczerpany budżet nie są obchodzone przez „kontynuuj”; brak ID od użytkownika, jeśli można je bezpiecznie odczytać |
| AC-07 | Review, zwykłe poprawki i dalsze autoryzowane taski postępują bez ponownej zgody; odbiór użytkownika pozostaje osobnym faktem |
| AC-08 | Brak pluginu/runtime albo błąd połączenia daje krótką konkretną diagnozę i dalszy krok, bez cichej nowej sesji, globalnych zmian lub eksportu prywatnych danych |
| AC-09 | README opisuje naturalne zlecenie, wznowienie i ograniczenie capacity; pakiety/instrukcje są spójne i realne sprawdzenie odróżnione od atrap |

## Walidacja i budżet

Bez modeli: testy wyboru ścieżki instrukcji i opcjonalnego zapisu preferencji, rzeczywiste
odmowy przy konfliktach/symlinkach, idempotentny setup, odzyskanie operacji na atrapach
z kontrolowanym ucięciem odpowiedzi. Dla każdego scenariusza podać stan przed/po,
liczbę uruchomień, klucz, kontrakt i wynik. Lista scenariuszy oceny instrukcji nie jest
dowodem zachowania modelu. Obowiązują build, testy JS/Python/pilot, packages:check,
kontrola linków i diff zgodnie z AGENTS; ponawiać tylko po istotnej zmianie.

Proponowany późniejszy smoke z modelami — obecnie NIEZLECONY:
- jeden nowy jednorazowy projekt i jedna para Astra–Claude;
- naturalne zlecenie małego featura, jedno kontrolowane przerwanie managera podczas
  rundy, dokładne resume i tylko „kontynuuj”, końcowe review bez syntetyzowania odbioru użytkownika;
- najwyżej 2 rundy Claude'a, po 32 tury i 30 minut; MCP 40 minut, segment 90 minut;
- do 8 tur Astry; bez nowej pary, resetu, dodatkowego recovery lub powtarzania całego
  scenariusza przy błędzie narzędzia operatora;
- po problemie zachować dowody i wznowić od udowodnionego punktu w pozostałym budżecie,
  jeśli stan jest jednoznaczny; nie traktować `num_turns` jako limitu `max_turns`;
- ograniczenia, wykorzystany budżet i brakujące dowody raportować wprost. Capacity
  symulować utratą odpowiedzi, nie próbować przeciążać usługi.

Budżet jest propozycją do osobnego zlecenia smoke, nie zgodą na modele w tej sesji.
Przed startem ocenić wykonalność czasu i pozostały zakres; nie powtarzać wcześniejszych
pilotów wave10/12 ani sprawdzać ponownie rozliczeń już zaakceptowanych dla danego testu.

## Świadomie odłożone

Powiadomienia systemowe/UI, supervisor osieroconych procesów, wzbudzanie zamkniętej Astry,
automatyczne retry capacity, zmiana modelu/dostawcy, /goal i nowy system zarządzania
projektami. Zgodność nowych wersji klientów jest osobnym utrzymaniem; zachować istniejące
guardy, nie rozszerzać macierzy wersji w tej fali. Nie obiecywać całkowicie bezobsługowej
pracy przy każdej awarii. Nie dodawać osobnego skilla „capacity”.
