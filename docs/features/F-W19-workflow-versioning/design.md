# F-W19 — projekt niezależnego wydawania i wyboru workflow

Status: korekty planu według decyzji01, do skupionego re-review, 2026-11-05. Bez implementacji.
Wejście: [brief](brief.md), SHA-256
`3856ac25d1c0f754846fefb6a88cc61e67e0ac3fe8b34a01d8a15ae898d6ee31`.
Badany kod: `417ddc2a846a56422a1cb04e463fc89bbfc42a27` (feature-workflow).
Poniższe interfejsy są propozycją do uszczegółowienia w W19-01, nie istniejącym API.

## Potwierdzony punkt wyjścia

- Generator `scripts/plugin-packages/generate.mjs` bierze wersję czterech paczek
  z package.json; bridge-claude zawiera kopię feature-*. Wspólny sourceDigest
  obejmuje również workflow, więc zmiana samych instrukcji zmienia marker bridge’a.
- `scripts/workflow-source/select-source.mjs` jest odczytem. W projekcie z poprawnym
  pinem wybiera runtime; samodzielnie wybiera własny plugin. Nie zna wersji featura.
- Launcher przekazuje runnerowi pakiety bridge-claude i feature-workflow-claude
  z runtime’u. Lista pluginDirs jest konfiguracją runnera, nie wyborem per feature.
  `--resume` zachowuje sesję; sama nowa ścieżka pluginu nie dowodzi nowych instrukcji.
- FeatureRecord nie zawiera wyboru workflow. SQLite zapisuje JSON featurów,
  schemat ma wersję 6. Odczyty tożsamości/statusu muszą pozostać bez mutacji.
- Instalator zachowuje historię lokalnego wyboru runtime; nie jest ona sama w sobie
  dowodem, jakie instrukcje obowiązywały każdy historyczny feature.
- Źródła skilli: .agents/skills/, wspólny guide i zasoby. Yumi CLI nie ma na PATH;
  taski stosują istniejący fallback Markdown work-items/, bez nowego task managera.

## Minimalny podział i wydawanie (AC-01, 02, 10)

Pozostają cztery obecne nazwy pluginów i dwa manifesty tego samego marketplace.
Wersja silnika pozostaje w package.json i dotychczasowym release.json. Nowy opis
wydania workflow, proponowany `scripts/workflow-source/release.json`, ma własną
wersję, dokładne źródło, tożsamość zawartości i wymagania zgodności. Numer początkowy
ustali wykonawca przy pierwszym wydaniu; równe numery nie implikują zgodności.
Tagi przyszłych wydań: `bridge-v<version>` i `workflow-v<version>`; stare v* zostają.
Publikacja tagów/wydania nie jest częścią tego lokalnego zlecenia.

Generator ma niezależne wejścia/digests i wybór komponentu do generacji/sprawdzenia.
Przy workflow-only zmienia tylko dwa pluginy feature-workflow i ich wpisy marketplace;
przy bridge-only pozostawia workflow bajtowo identyczny. Test porównuje całe drzewa,
łącznie z GENERATED.json, manifestami, helperami i pinem, a nie tylko numery wersji.
Wspólny plik marketplace może się zmienić: porównujemy niezmieniony wpis drugiego
komponentu, nie cały plik. Nie dotyczy to niezmienności pełnego drzewa jego paczek.
Wydanie istniejącego numeru o innych bajtach jest odrzucane. Generator nie może
wbudować bieżącego HEAD ani wspólnego digestu w niezmieniony komponent.

Nowy bridge-claude dostarcza role/upgrade/bootstrap, bez własnych konkurencyjnych
feature-*; zachowanie starych, niezmiennych runtime’ów pozostaje nietknięte.
Workflow obejmuje siedem skilli, referencje, guide, feature_exchange.py, wybór źródła
oraz oba warianty klientowe. Instrukcje API silnika, using-bridge, setup i recovery
techniczne pozostają runtime-owned. W19-01 spisze granicę współdzielonych referencji,
aby nowy guide nie wymagał plików spoza wybranego zestawu.

## Niezmienny zestaw workflow i wybór przed implementacją (AC-03, 08, 10)

Jedno wydanie zawiera kanoniczne zasoby, oba warianty klientowe i manifest z listą
plików/hashami, wersją formatu oraz wymaganiami runtime’u. Tożsamość obejmuje
całą treść, nie nazwę katalogu/cache’u. Obie paczki klientowe dostarczają ten sam
kompletny zestaw, aby instalacja tylko u koordynatora wystarczyła dla Claude’a.
Nie wymaga to npm ci, instalacji MCP ani sieci przy użyciu standalone.

Mały wspólny helper, proponowany scripts/workflow-source/workflow.mjs, potrafi
zachować/sprawdzić dokładne wydanie pod `<bridge-home>/workflows/<identity>/`.
Nazwa bridge-home oznacza współdzielony magazyn dystrybucji; standalone używa tylko
jego części workflow, bez runtime’u, bazy czy setupu projektu. Publikacja katalogu
atomowa, po weryfikacji wszystkich plików; brak nadpisania istniejącej tożsamości,
ścieżek wychodzących poza pakiet ani zapisów przez symlinki. Kopia ma być niezależna
od cache’u marketplace. Uszkodzenie/brak daje diagnozę i odtworzenie dokładnego
wydania z lokalnej paczki albo wskazanego źródła; zero samowolnego latest/fallbacku.

Aktywne wejście pluginu ustala wydanie z własnej lokalizacji i manifestu, nie ze
skanowania cache’ów, dat plików ani najwyższego semver. Niejednoznaczne wejście jest
jawne. Już wybrany feature zawsze kieruje do zachowanego zestawu. Rozwiązanie
repozytoryjne wskazane jawnie przez użytkownika także musi mieć identyfikowalny
snapshot; nie wolno traktować ruchomego brancha jako wydania.

Przed pierwszą zależną czynnością fazy powstaje `workflow.lock.json` w katalogu
featura: wersja/identity/manifest hash, generacja wyboru i pochodzenie. Nie zawiera
ścieżek osobistych, natywnych ID sesji, zgód ani statusów lifecycle. Jest małym
rejestrem wyboru instrukcji, nie drugim indeksem/procesem featura. Helper może
utworzyć katalog i lock zanim powstanie brief lub feature.json. Po przydzieleniu
ID przez design ten sam katalog/lock jest rejestrowany w zwykłym indeksie.
Przy przeniesieniu/zmianie ID zachowujemy identity i kontrolujemy konflikt; W19-01
definiuje draft path → final ID, wznowienie przenoszenia i kolizję katalogów.

`select-source` pozostaje czystym odczytem; zwraca wybraną paczkę lub jawne
`selection required` przed pracą. Jawny begin/select helper zapisuje kopię i lock
po potwierdzeniu zgodności. Preambuła wszystkich wejść odsyła przez ten bootstrap,
po czym agent czyta właściwy skill/guide z zachowanego wydania. Sam status/doctor
nie tworzy locka, katalogu stanu ani migracji.

## Powiązanie z bridge i kontrolowana zmiana (AC-05…08)

Jednorazowa nowa wersja silnika udostępnia obsługę workflow binding, kompatybilność
formatu i capabilities. Nowy workflow sprawdza je przed zależną pracą; nie zakłada,
że stary runtime obsługuje pole, którego nie zna. W19-01 ustali publiczne nazwy
operacji i format błędów. Zgodność ma dwa składniki: wspierany kontrakt/formats oraz
wymagane możliwości, ewentualnie jawny zakres wersji dla znanych ograniczeń.
Zgodna poprawka tekstu nie zmienia runtime’u/configu projektu. Brak możliwości
zatrzymuje zależne operacje przed workerem, bindem lub zmianą pina.

Przy pierwszym dołączeniu do bridge uprawniony manager importuje zweryfikowany
lock do istniejącego FeatureRecord: identity, generacja i historia zmian. DB staje
się operacyjnym źródłem wyboru dla rund, a plik stanowi przenośną referencję,
której rozbieżności są diagnozowane, nigdy rozstrzygane po mtime. Dokument nie
uprawnia do przejęcia managera/featura. Bind nie tworzy drugiego featura ani nowego
roota; istniejące ownership, leases, idempotencja i reguły waiting_user pozostają.
Proponowana migracja schematu 6 → 7 ma zapobiec uruchomieniu starszego runtime’u,
który zignorowałby zapisany binding. Ostateczny numer wymaga sprawdzenia bazy wejścia.

Rezerwacja rundy/recovery utrwala identity/generację razem z próbą i weryfikuje
pakiet przed startem procesu. Runner wybiera paczki z tego rekordu, nie globalnej
konfiguracji ani bieżącego pluginu managera. Identyczne ponowienie nie dokonuje
nowego wyboru. Niedostępny zestaw daje blokadę z dowodem, bez zastępczego zadania.

Jawne switch pokazuje obecne/docelowe wydanie, sprawdza zgodność, uprawnienia,
brak aktywnej i nierozliczonej próby oraz klientowe warunki przeładowania. Zachowuje
feature/task/session identity i decyzje; nie usuwa wcześniejszych zdarzeń. Używa
idempotency key i expected generation. Zmiana DB i projekcja locka mają protokół
odporny na przerwanie: najpierw zweryfikowany bundle, potem trwała intencja/commit
pod kontrolą managera, na końcu odtwarzalna projekcja pliku. Nierozliczony switch
blokuje rundy; status opisuje stan, lecz go nie naprawia. Standalone ten sam helper
wykonuje atomową zmianę locka i zachowuje historię wyborów, bez tworzenia DB.

Nie wystarcza wymienić --plugin-dir w długiej sesji. W19-01 sprawdzi bootstrap,
przeczytanie wskazanego nowego skilla oraz jawne potwierdzenie identity przez obu
agentów. Jeżeli klient wymaga restartu, switch pozostaje oczekujący do normalnego
resume tej samej sesji. Brak wspieranej drogi zachowania sesji zatrzymuje zależny
zakres z dowodem i decyzją o zakresie — nie wolno deklarować sukcesu czy tworzyć
nowej sesji. Ta bramka jest lokalnym testem wykonalności, nie nowym odbiorem taska.

## Migracja i dotychczasowe feature’y (AC-07)

Upgrade zachowuje dokładny dotychczasowy runtime/instrukcje i pochodzenie przed
zmianą wyboru. Dla starych featurów bez locka przygotowuje legacy snapshot z tego
zestawu, nie z aktualnego marketplace. Sam odczyt nie przypisuje żadnej wersji.
Jawna operacja migracji/bind z autoryzacją managera zapisuje pochodzenie bez
przepisywania dawnych prób. Snapshot legacy zachowuje dotychczasową treść należącą do workflow, a nie cały
stary plugin bridge-claude. Wyciągamy tylko feature-*, guide i ich zasoby;
using-bridge, bridge-upgrade i techniczne reguły API zawsze dostarcza bieżący runtime.
Adapter opakowania nie zmienia starych reguł workflow i ma własną proweniencję/hash;
nie wolno przekazać dawnej bridge-claude, która nadpisze obecne role po nazwie pluginu.
Legacy bez manifestu dostaje jawny profil zgodności/deklarację z dokładnym pochodzeniem,
sprawdzaną względem nowego silnika i formatu dostaw; nie jest zwolniony z kontroli
kompatybilności. Niepotwierdzona zgodność zatrzymuje zależny zakres i wymaga dowodu.
Wszystkie nowe rundy używają tej referencji aż do jawnego switch.

Okno przejściowe nowy plugin + projekt nadal na starym pinie jest osobną gałęzią:
istniejący legacy feature kontynuuje przez dotychczasowy selector/runtime według
udowodnionego starego zestawu, bez wybrania nowego pluginu i bez udawania bindingu.
Nowy feature wymagający niezależnego wyboru otrzymuje diagnozę brakującego kontraktu
oraz wskazanie jednorazowego upgrade; plugin nie wykonuje go automatycznie.
Brak dowodu starego zestawu lub brak danego entry w nim daje konkretną odmowę,
nie cichą adopcję nowego workflow. W19-01 obejmuje fixtures tych trzech przypadków:
rozłączność ról, deklaracja legacy i oba rodzaje featura przy starym pinie.
W19-01 musi także pokazać fixtures obejmujące
trwający feature, przerwany upgrade i niejednoznaczną historię. Jeśli nie ma dowodu
starego zestawu, odmowa i wskazanie brakującego źródła; nie wybór najnowszego.
Downgrade runtime’u sprawdza schemat i kontrakt przed zapisem. Historycznych paczek
oraz nadzorującego runtime’u nie edytujemy.

## Diagnostyka i integracja (AC-09, 10)

Status rozróżnia runtime projektu, plugin wejściowy klienta i wybór featura,
identity/hash/generację, zgodność, dostępność kopii oraz deklarację vs obserwację.
Potwierdzenie agenta oznacza jego odczyt/deklarację, nie dowód działania całego
modelu ani ochronę przed złośliwym procesem tego samego użytkownika. Dowód AC-04
wymaga rzeczywistej pracy i odczytu specyficznych instrukcji w próbie klienta.
Diagnostyka ma allowlistę tych pól; bez treści skilli, promptów, ścieżek prywatnych
czy identyfikatorów natywnych. Eksport feature-exchange zachowuje lock/proweniencję,
nie bezwiednie nowszy workflow. Import nie zmienia lokalnego wyboru po cichu.
Doctor/docs wskazują rozpoznane stare osobiste entry bridge-claude:feature-* bez
bootstrapu i zalecają upgrade lub wyłączenie, bez automatycznego usuwania pluginu.
Nie udajemy kontroli nad dowolnym już załadowanym skillem. Gwarancja delegacji
w tym feature dotyczy Codex-manager → Claude-worker. Odwrotny kierunek pozostaje
przy obecnym kontrakcie poza nowym bindingiem; nowy binding nie może uruchomić
nieobsługiwanego wykonawcy z udawaną gwarancją. Oba interaktywne klienty i standalone
pozostają w zakresie.

W19-01 posiada wspólny kontrakt; W19-02 helper/formats i generator; W19-03 bazę,
rezerwacje i recovery; W19-04 wejścia skilli, bootstrap i runner; W19-05 diagnostykę
oraz instrukcje użytkownika; W19-06 integrację/review/testy klientów. Taski zawierają
zależności wykonania i są źródłem prawdy. Potencjalne równoległe prace W19-03/04
wymagają najpierw jawnego replanu zależności (obecnie04 zależy od03),
zamrożonego kontraktu, rozłącznych plików i integratora; domyślnie sekwencja
bez mnożenia agentów/worktree. Koordynator jest integratorem i właścicielem indeksu,
review/decyzji; wykonawca zapisuje taskowe ledgery i commity w swoim zakresie.

## Dowody i budżet proponowany do Gate 1

| AC | Dowód wymagany przed odbiorem całego featura |
| --- | --- |
| 01 | Zmiana tylko jednego komponentu: drugi ma identyczną pełną inwentaryzację, wersję i pin; stare tagi/fixture’y niezmienione. |
| 02–04 | Dwa przygotowane projekty/worktree z tym samym runtime, wydania A/B; nowy feature używa B bez update projektu, stary A po usunięciu cache’u. Rzeczywiste wejście managera i Claude’a, starszy/brak osobistego pluginu wykonawcy, obserwacje z obu stron. |
| 05 | Niekompatybilny manifest, stary runtime, brak capability i uszkodzony zestaw: brak nowej próby/claim/pina; zgodna zmiana tekstu działa. |
| 06 | Switch przy aktywnym workerze odmawia bez skutku; po przerwaniu/restartach kończy dokładnie raz w tych samych sesjach; crash fixtures dla etapów. |
| 07 | Stary feature po upgrade i resume zachowuje snapshot legacy; upgrade przerwany/niejednoznaczne źródło bez cichej adopcji. |
| 08 | Begin przed briefem/indeksem, compaction/resume i brak cache’u offline; wykrycie uszkodzenia/braku kopii i dokładna odbudowa. |
| 09–10 | Status/doctor/import/export pozostają odczytem lub wymagają jawnej mutacji; prywatność; standalone bez MCP/runtime’u i bez sieci. |

Testy bez modeli: pełne repo checks z AGENTS oraz ukierunkowane generator/source,
SQLite/identity/reservation/recovery, filesystem/symlinks, lock/switch crash points,
standalone/export/privacy i prawdziwe starty obu klientów bez inferencji. Dowody
hosta podają rzeczywiste wersje; fixtures nie zastępują pilota. Znane awarie bazowe
odróżniać przez porównanie z 417ddc2, nie usuwać testów ani zmieniać historycznych
fixture’ów, żeby uzyskać zielony wynik. Ograniczone miejsce /tmp: duże scratch na
woluminie home, bez czyszczenia cudzych dowodów.

Proponowany pilot W19-06 działa wyłącznie w izolowanych konfiguracjach i cache’ach
klientów (wspierane przez ich CLI CODEX_HOME / CLAUDE_CONFIG_DIR, zweryfikowane
w próbach W19-01), osobnym bridge-home i syntetycznych projektach. Instalacja A/B,
usuwanie cache’u, trust i restarty dotyczą tylko tych katalogów, nigdy osobistych
instalacji/projektów. Polecenia potwierdzają efektywne ścieżki; jeśli klient nie
honoruje izolacji, zatrzymać pilot przed zmianą profilu. Istniejące logowanie
subskrypcyjne można wykorzystać jedynie wspieraną drogą w izolacji; brak takiej
możliwości to checkpoint i konkretne pytanie o dostęp, bez cichego przeniesienia
próby do prawdziwego profilu lub nowego API. Dowody prywatne zachować do odbioru,
bez automatycznego czyszczenia; nie ma osobistych zmian do przywracania.

Pilot: syntetyczne dane, dwa projekty, A/B, najwyżej sześć rund
Claude’a po max_turns=64, deadline 75 min/runda, timeout MCP 90 min. Łączny czas
części modelowej do 180 min i do 24 tur Astry; limity per-runda nie znoszą całości.
Test obejmuje pierwszą pracę, zachowanie A po upgrade/cache deletion, nowy B i jawny
switch A→B w zachowanych natywnych sesjach, z wymaganym restartem jeśli potrzebny.
Jedna z sześciu rund stanowi rezerwę na zwykłą poprawkę narzędzia/testu; bez resetu
stanu czy zastępczych sesji. Dalszy budżet wymaga rzeczywistej decyzji, nie zgody
na każdy Enter. Użycie obecnych subskrypcji, bez nowych kluczy/płatnego API;
nie dodawać osobnej kontroli panelu billingowego. Symulowany odbiór w fixture jest
oznaczony i nie zastępuje użytkownika. Dane/dowody prywatne poza Git, w raporcie
wyłącznie syntetyczne wyniki. Pilot nie jest uruchomiony ani zatwierdzony tym planem.

W19-01 może zmienić nazwy pól/operacji i rozkład techniczny w powyższych granicach.
Jeśli wyniki wymuszają osłabienie AC, nową sesję, uprawnienia albo większy budżet,
przedstawić konkretną decyzję i kontynuować niezależny zakres. Zakończenie kontraktu
lub taska nie tworzy nowej zewnętrznej bramki. Wykonanie całego zakresu, lokalne
review i zwykłe poprawki obejmie jedna przyszła zgoda użytkownika. Merge, push,
wydanie, masowy upgrade projektów i aktywne runtime’y pozostają poza nią.
