# Review planu F-W19 (tryb `plan`): wynik REWORK

## Podsumowanie

**Werdykt: REWORK.** Poprawki są wąskie, dotyczą tylko tekstu planu i można je zrobić w jednej partii. Nie ma potrzeby przeprojektowania.

Plan dobrze trafia w cel briefu. Proponuje osobne wydanie workflow z własnym manifestem i własnymi skrótami treści (digests). Wybrane wydanie jest kopiowane do trwałego magazynu poza cache'em marketplace. Feature dostaje `workflow.lock.json` jeszcze przed powstaniem indeksu. Przy pierwszym podłączeniu do bridge'a lock trafia do istniejącego FeatureRecord, każda próba zapamiętuje wybrane wydanie, a switch działa transakcyjnie. Rzeczywiste ryzyko ponownego wczytania instrukcji w tej samej sesji jest uczciwie oznaczone jako bramka W19-01 i pilot W19-06.

Każde twierdzenie o stanie obecnym, które sprawdziłem w kodzie, jest prawdziwe.

Przed Gate 1 trzeba poprawić dwie rzeczy:
- **R19-P01:** opis przejścia starych featurów jest niepełny w trzech konkretnych przypadkach (AC-07, wymaganie 9, brief w. 45–47).
- **R19-P02:** proponowany pilot nie mówi, w jakim środowisku klientów działa. Usuwanie cache'u pluginu i instalacja wersji A/B mogą dotknąć prawdziwych profili użytkownika.

Pozostałe ustalenia są uwagami, które nie blokują.

Nie udzielam zgody na wykonanie. PASS po poprawkach będzie rekomendacją, nie decyzją użytkownika.

## Co dokładnie przejrzałem

- **Commit planu:** `fb3e6c56875c4bb4b11c8dbf770e1358be03fd1f` w izolowanym worktree planowania. HEAD jest równy temu commitowi, worktree jest czysty.
- **Baza:** `417ddc2a846a56422a1cb04e463fc89bbfc42a27`. Diff obejmuje 11 plików, +401 linii, wyłącznie dokumentację.
- **Brief:** `docs/features/F-W19-workflow-versioning/brief.md`, SHA-256 `3856ac25d1c0f754846fefb6a88cc61e67e0ac3fe8b34a01d8a15ae898d6ee31`. Hash się zgadza. Commit planu nie zmienia briefu.
- **Dokumenty planu:** `design.md`, `feature.json`, `PROGRESS.md`, `work-items/W19-{P01,01,02,03,04,05,06}.md` oraz wpis w `docs/HANDOFF.md`.
- **Zasady:** `.agents/skills/feature-review/SKILL.md` i `docs/features/README.md`.
- **Kod, który czytałem przy bazie 417ddc2:**
  - `scripts/plugin-packages/generate.mjs`: skład paczek, `sourceDigest`, `workflowSourceDigest`, marketplace;
  - `scripts/plugin-packages/release.json`;
  - `scripts/workflow-source/select-source.mjs` i szablon preambuły;
  - `scripts/native-bridge-mcp.mjs`: `EXECUTOR_PACKAGES` i budowa runnera;
  - `claude/claude-side/src/adapters/claude-code-runner.ts`: `pluginDir`/`pluginDirs`, `--resume`;
  - `shared/control-plane/src/store/sqlite-store.ts`: `SCHEMA_VERSION = 6`, odmowa nowszego schematu, tabela `features(json)`;
  - `scripts/bridge-project/locate.mjs`: `instructionPaths`;
  - `docs/usage.md`: wykonawca Codex;
  - tagi Git.
- **Niezależność:** jestem niezależny od autora planu. Działam jako delegowany reviewer, tylko do odczytu.

## Weryfikacja twierdzeń planu w kodzie

| Twierdzenie z `design.md` | Wynik |
| --- | --- |
| Jedna wersja z `package.json` dla czterech paczek | Potwierdzone: `packageVersion()` i `generate()` |
| `bridge-claude` zawiera kopie `feature-*` | Potwierdzone: `claudePackage()` kopiuje `WORKFLOW_SKILLS` bez preambuły |
| Wspólny `sourceDigest` obejmuje workflow, także w markerach `bridge-codex` i `bridge-claude` | Potwierdzone |
| `select-source` tylko czyta; w projekcie z pinem wybiera runtime | Potwierdzone (`reads_only`, `PINNED_RUNTIME`) |
| Lista pakietów runnera jest stałą konfiguracją, a nie wyborem per feature | Potwierdzone: `executorPackages()` raz przy starcie launchera |
| SQLite trzyma JSON featurów, schemat w wersji 6; starszy build odmawia nowszego schematu | Potwierdzone: `schema_unsupported` także w trybie attach/readonly, więc przejście 6→7 rzeczywiście zablokuje stary runtime |
| Stare tagi `v*` | Potwierdzone: v0.4.3 … v0.6.2 |

## Ustalenia

### R19-P01: przejście starych featurów jest opisane niepełnie (do poprawy przed Gate 1, drobne)

**Wymagania:** brief pkt 11 i AC-07 (stary feature zachowuje dotychczasowy workflow, kontrolowane przejście), pkt 9 (workflow deklaruje wymagania wobec silnika, sprawdzane przed zależną pracą), w. 45–47 (`using-bridge`, setup i upgrade zgodne z rzeczywistym runtime'em; zakaz podmiany technicznych reguł silnika).

**Obserwacje:**
1. Design mówi, że snapshot legacy „zachowuje dotychczasowe warianty klientowe, także gdy wymagają dawnych kopii w `bridge-claude`”. Dzisiaj `bridge-claude` zawiera obok `feature-*` także `using-bridge` i `bridge-upgrade`, czyli instrukcje należące do runtime'u (`generate.mjs`, `claudePackage`). Runner rozpoznaje `--plugin-dir` po nazwie pluginu (komentarz W17-01 w `claude-code-runner.ts`). Przekazanie starej `bridge-claude` nowemu silnikowi podstawiłoby więc stare reguły API zamiast nowych. Plan nie mówi, że legacy bierze tylko treść należącą do workflow, a reguły runtime'u zawsze pochodzą z bieżącego runtime'u.
2. Stary zestaw nie ma manifestu wymagań. Plan nie określa, jak taki zestaw przechodzi kontrolę zgodności z pkt 9 na nowym silniku. Możliwości to np. syntetyczna deklaracja z pochodzeniem albo jawny profil zgodności legacy.
3. Brakuje okna przejściowego: nowy plugin workflow jest zainstalowany na komputerze, ale projekt jest nadal przypięty do runtime'u sprzed tej funkcji (np. 0.6.2). Plan obejmuje tylko przypadek „stary runtime daje diagnozę” (tabela AC-05). Nie mówi, co dzieje się wtedy z istniejącym, niepowiązanym featurem. Pkt 11 każe mu zachować dotychczasowe instrukcje, dziś przekierowane przez preambułę do runtime'u, bez zgadywania i bez blokowania go przez nowy plugin.

**Wpływ:** wykonawca W19-01 lub W19-03 musiałby sam rozstrzygnąć, co jest dozwolone. Dosłowne odczytanie punktu 1 łamie w. 45–47.

**Dyspozycja:** wymagana poprawka planu przed Gate 1. To poprawka specyfikacji, nie kontrakt W19-01 do napisania już teraz.

**Minimalna poprawka:** dodać w `design.md` (sekcja Migracja) i w polu „Odbiór” W19-01 trzy przypadki z fixtures:
- (a) legacy zawiera tylko treść należącą do workflow, a `using-bridge` i upgrade pochodzą z bieżącego runtime'u;
- (b) sposób deklarowania i sprawdzania zgodności zestawu legacy;
- (c) zachowanie nowego pluginu w projekcie z pinem sprzed tej funkcji, osobno dla nowego i dla starego featura.

Konkretne nazwy i formaty może ustalić W19-01.

### R19-P02: pilot nie określa środowiska klientów (do poprawy przed Gate 1)

**Wymaganie:** brief w. 146–149: zakres i budżet pilota ustala się przed jego wykonaniem; mały pilot klientów.

**Obserwacja:** pilot w `design.md` i W19-06 wymaga instalacji wydań A/B pluginu w Codexie i Claude Code, usunięcia cache'u, zostawienia starego lub braku osobistego pluginu u wykonawcy oraz restartów klientów. Ani design, ani W19-06 nie mówią, czy to się dzieje w izolowanych profilach klientów, czy w prawdziwych profilach użytkownika. Nie ma też planu przywrócenia stanu ani informacji, co zrobić, jeśli logowanie przez subskrypcję nie działa w izolowanym profilu. „Izolowane home/worktree” w W19-06 dotyczy części bez modeli.

**Wpływ:** zgoda na Gate 1 mogłaby objąć niejawną, częściowo destrukcyjną zmianę osobistych instalacji pluginów i cache'u. Bez tego zakres pilota nie jest ustalony.

**Dyspozycja:** wymagane przed Gate 1. Można to zapisać w W19-06/design albo w proponowanej decyzji Gate 1.

**Minimalna poprawka:** jeden akapit. Do wyboru: albo izolowane katalogi konfiguracji i pluginów klientów, albo jawna lista zmian w prawdziwym profilu z kopią zapasową i przywróceniem. Do tego reguła: jeśli logowanie nie działa w izolacji, potrzebna jest decyzja, bez obchodzenia problemu.

### Uwagi nieblokujące (do rozliczenia w jednej partii)

- **R19-P03, spójność:** design wspomina możliwą równoległość W19-03/04, a W19-04 zależy od W19-03. Taski są źródłem prawdy, więc kolejność jest poprawna. Warto dopisać, że równoległość wymaga zmiany zależności przez replan.
- **R19-P04, AC-04/09, pkt 6:** osobista, stara `bridge-claude` w interaktywnym Claudzie zawiera `bridge-claude:feature-*` bez preambuły. Takie wejście pomija bootstrap i lock. U delegowanego wykonawcy problem znika dzięki nadpisaniu po nazwie. Rekomendacja: W19-05 (doctor i docs) wykrywa nieaktualne kopie i doradza aktualizację lub wyłączenie.
- **R19-P05, zakres:** istnieje wykonawca Codex delegowany przez managera Claude'a (`docs/usage.md:34`), który nie dostaje żadnej paczki instrukcji. Brief wymienia Astrę i Claude'a. Warto jednym zdaniem napisać, czy ten kierunek obejmuje bootstrap z lockiem, czy jest poza zakresem.
- **R19-P06, kontrakt W19-01:** lock przed nadaniem ID i „ten sam katalog” po nadaniu ID wymagają ustalenia nazwy katalogu tymczasowego i reguły przenoszenia. To prawidłowo należy do bramki W19-01; odnotowuję tylko.
- **R19-P07, test AC-01:** pliki marketplace są wspólne. Przy wydaniu samego workflow plik się zmieni, więc test powinien porównywać wpisy bridge'a w tym pliku, a nie całe bajty pliku.
- **R19-P08, ryzyko:** dowód ponownego wczytania instrukcji w tej samej sesji pojawi się dopiero w pilocie W19-06, bo próby W19-01 działają bez modeli. Plan to ujawnia i ma regułę stopu. Ewentualna wczesna mała próba z modelem to wybór budżetowy w decyzji Gate 1, nie wymóg. Limit 24 tur Astry przy około 5 scenariuszach i restartach jest ciasny, ale ma regułę stopu.

## Pokrycie AC-01…10

| AC | Gdzie w planie | Ocena |
| --- | --- | --- |
| 01 | W19-02 (osobne digests, porównanie całych drzew, odrzucenie ponownego wydania tego samego numeru), W19-06 | Pokryte (+P07) |
| 02 | W19-02 bundle, W19-04 wybór i bootstrap, pilot z dwoma projektami | Pokryte |
| 03 | Magazyn `<bridge-home>/workflows`, binding W19-03, runner W19-04, pilot z usunięciem cache'u | Pokryte |
| 04 | Pakiety per próba W19-04, rzeczywiste dowody W19-06, reguła NOT_TESTED | Pokryte (+P04, P05) |
| 05 | Kompatybilność (kontrakt i capabilities) W19-01/03, kontrola przed workerem, bindem i pinem | Pokryte, z wyjątkiem legacy (P01b) |
| 06 | Switch z kluczem idempotencji i oczekiwaną generacją, protokół bundle → intencja → projekcja, odmowa przy aktywnej próbie, punkty awarii, reload/ack albo restart tej samej sesji | Pokryte; wykonalność zależy od bramki W19-01 i pilota |
| 07 | Migracja 6→7, legacy z pochodzeniem, odmowa bez dowodu | **Częściowo:** R19-P01 |
| 08 | Lock przed indeksem, compaction i resume, offline, wykrycie uszkodzenia i odbudowa | Pokryte (+P06) |
| 09 | W19-05: status rozróżnia runtime, plugin i wybór featura, deklarację od obserwacji; allowlista pól; dokumentacja | Pokryte |
| 10 | Helper bez runtime'u i sieci, eksport zachowuje lock, import nie zmienia wyboru | Pokryte |

## Pozostałe pytania z zakresu review

- **Niezależność artefaktów wydania:** podejście jest poprawne. Generator dostaje osobne wejścia, digests i wybór komponentu, nie wbudowuje HEAD i porównuje pełne inwentaryzacje.
- **Wybór przed indeksem:** lock w katalogu featura nie tworzy drugiego cyklu życia, więc spełnia pkt 5. Szczegół ID zostaje dla W19-01 (P06).
- **Spójność managera i workera, ta sama sesja:** bootstrap, odczyt nowego skilla, potwierdzenie identity przez obu agentów, w razie potrzeby oczekujący switch do zwykłego resume tej samej sesji, zakaz tworzenia nowej sesji. Zgodne z pkt 6 i 8.
- **Transakcyjność bindu i switcha:** wystarczająco określona na poziomie planu.
- **Zależności tasków:** 01 → 02 → 03 → 04 → 05 → 06. Są poprawne, bez duplikatów, z wyznaczonym jednym właścicielem generowanych `plugins/`.
- **Proponowany pilot:** budżet, reguły stopu, brak sesji zastępczych i NOT_TESTED dla AC-04 są poprawne. Brakuje środowiska (R19-P02).

## Wykonane kontrole i ograniczenia

- SHA-256 briefu zgodny; `git diff --name-only` pokazuje brak zmian briefu w planie.
- `feature.json` parsuje się poprawnie; wszystkie ścieżki z `tasks`, `context_files`, `brief` i `design` istnieją; linki Markdown w taskach, design i PROGRESS nie są zepsute (exit 0).
- `git diff --check 417ddc2..fb3e6c5`: exit 0.
- Kod sprawdzałem przez czytanie. Nie uruchamiałem testów produktu, buildów, klientów ani modeli, bo zadanie jest tylko do odczytu, a plan nie zawiera kodu.
- Nie oceniam wykonalności ponownego wczytania instrukcji w sesji. Rozstrzygną to próby W19-01 i pilot.
- Nic nie zapisałem.

## Rekomendacja

Poprawić R19-P01 i R19-P02 w jednej partii, razem z ewentualnymi krótkimi odpowiedziami na P03–P07 albo jawną decyzją o ich odrzuceniu. Następnie zrobić jedno skupione ponowne review tylko tych zmian i przygotować proponowaną decyzję Gate 1 z pilotem i jego środowiskiem. Jeśli ta sama kwestia wróci w dwóch kolejnych rundach, trzeba się zatrzymać i zapytać użytkownika.


## Nota zapisu koordynatora

Zapis prozy niezależnego raportu; końcowy techniczny JSON powtarzający treść pominięto.
Pełny raport pozostaje w prywatnym artefakcie bridge’a; hash treści:
`d40fea08feb159f2ef37116ea454034f3a759459f66b2894e8eec80cb6c9d1bc`.
Bez produktu, pilota ani akceptacji użytkownika. Reguły kontynuacji wynikają ze skilli
oraz preferencji użytkownika: step-back przy trzecim review tego samego problemu,
impas po dwóch rundach bez postępu; sam kolejny numer review nie jest blokadą.

---

## Dopisek 2026-11-05: skupione review korekt (tryb `corrections`), wynik PASS

**Podsumowanie.** Wynik: **PASS**. Obie wymagane poprawki są rozwiązane: R19-P01 i R19-P02 mają status `resolved`. Brief się nie zmienił, a korekty nie osłabiają żadnego AC. Uwagi P03…P08 są rozliczone zgodnie z decyzją 01. Nie znalazłem żadnej nowej regresji, która blokowałaby plan. Plan może przejść do przygotowania proponowanej decyzji Gate 1 (feature-decide). Ten PASS to rekomendacja reviewera. Nie jest zgodą użytkownika na wykonanie ani na pilot.

**Co sprawdziłem**
- Commit z korektami: `c8575e743c1a9c7b3ad44f2d3e17d0255517c4c6` w worktree planowania. HEAD wskazuje ten commit, worktree jest czysty.
- Zakres diffu `0a8b418..c8575e7`: 8 plików, +73/−11, tylko dokumentacja: `design.md`, `feature.json`, `PROGRESS.md`, `work-items/W19-01, 02, 04, 05, 06`.
- Brief: SHA-256 `3856ac25d1c0f754846fefb6a88cc61e67e0ac3fe8b34a01d8a15ae898d6ee31`, zgodny z oczekiwanym. Diff nie zmienia briefu, `reviews/` ani `decisions/`.
- Punkty odniesienia: review `reviews/01-plan.md` (plan `fb3e6c5`) oraz decyzja `decisions/01.md` (commit `0a8b418`).
- Niezależność: nie jestem autorem planu ani korekt. Pracowałem tylko w trybie odczytu, niczego nie delegowałem i nie zapisałem.

### Status wymaganych poprawek

**R19-P01: `resolved`.** Każdy z trzech przypadków z review ma teraz w planie konkretny zapis:
- **(a) Legacy nie zawiera ról runtime'u** (brief w. 45–47).
  - `design.md`, sekcja Migracja: snapshot legacy bierze tylko `feature-*`, guide i ich zasoby. `using-bridge`, `bridge-upgrade` i reguły API zawsze pochodzą z bieżącego runtime'u.
  - Plan zabrania przekazywania dawnej `bridge-claude`, bo nadpisałaby obecne role po nazwie pluginu.
  - Adapter opakowania ma własną proweniencję i hash.
  - Usunięte zostało zdanie „warianty… także gdy wymagają dawnych kopii w bridge-claude”, które pozwalało na naruszenie.
  - W19-01, pole Odbiór: fixture „legacy wyodrębnia wyłącznie workflow, aktualne role/API z runtime”.
- **(b) Profil zgodności legacy** (brief pkt 9).
  - Legacy bez manifestu dostaje jawny profil zgodności z dokładnym pochodzeniem.
  - Profil jest sprawdzany względem nowego silnika i formatu dostaw. Legacy nie jest z tej kontroli zwolnione.
  - Jeśli zgodności nie da się potwierdzić, zależny zakres zostaje zatrzymany.
  - W19-01 ma odpowiadający temu fixture.
- **(c) Nowy plugin przy starym pinie** (brief pkt 11, AC-07).
  - Ten przypadek jest opisany jako osobna gałąź.
  - Istniejący feature działa dalej na dotychczasowym selektorze i runtime, według udowodnionego starego zestawu. Plugin nie wybiera nowego workflow i nie udaje bindingu.
  - Nowy feature dostaje diagnozę i wskazanie jednorazowego upgrade. Upgrade nie uruchamia się automatycznie.
  - Brak dowodu albo brak danego wejścia w starym zestawie kończy się konkretną odmową.
  - W19-01 ma fixtures osobno dla starego i dla nowego featura.

Tak jak zakładało review, nazwy i formaty zostają w kontrakcie W19-01.

**R19-P02: `resolved`.** Zapis jest w `design.md` (akapit o pilocie) i w W19-06 (w. 19–23):
- Pilot działa tylko w izolowanych konfiguracjach i cache'ach obu klientów (`CODEX_HOME` / `CLAUDE_CONFIG_DIR`), w osobnym bridge-home i na syntetycznych projektach.
- Instalacja A/B, usuwanie cache'u, trust i restarty nigdy nie dotykają osobistych profili.
- Przed startem trzeba potwierdzić efektywne ścieżki. Jeśli klient nie honoruje izolacji, pilot zatrzymuje się przed zmianą profilu.
- Logowanie subskrypcyjne wolno użyć tylko wspieraną drogą w izolacji. Jeśli to niemożliwe: checkpoint i konkretne pytanie, bez przenoszenia próby do prawdziwego profilu ani na API.
- Nie ma osobistych zmian, więc nie trzeba niczego przywracać. Dowody prywatne zostają zachowane.
- W19-01 sprawdza wcześniej efektywne ścieżki i dostęp do logowania.
- Budżet pilota się nie zmienił.

### Rozliczenie uwag nieblokujących
- **P03:** design mówi teraz, że równoległość wymaga replanu zależności (W19-04 zależy od 03). Rozliczone.
- **P04:** design i W19-05: doctor i docs wykrywają stare osobiste wejścia `bridge-claude:feature-*` i zalecają upgrade lub wyłączenie, bez usuwania i bez obietnicy kontroli nad załadowanymi skillami. Rozliczone.
- **P05:** design i W19-04: gwarancja dotyczy tylko kierunku Codex-manager → Claude-worker. Nieobsługiwany wykonawca jest odrzucany pod nowym bindingiem. Interaktywne klienty i standalone pozostają w zakresie. Rozliczone.
- **P06:** design i W19-01 opisują przejście ze ścieżki roboczej do docelowego ID, w tym kolizję i przerwanie, bez drugiego cyklu życia featura. Rozliczone.
- **P07:** design i W19-02: we wspólnym marketplace porównuje się tylko wpis drugiego komponentu. Paczki nadal muszą być identyczne co do bajtu. Rozliczone.
- **P08:** decyzja 01 świadomie zostawia to ryzyko, bez wczesnej próby z modelem. Plan nie wymagał zmiany. Rozliczone.

### Drobne uwagi, nieblokujące (nie tworzą nowej bramki)
- **R19-P09:** reguła izolacji jest zapisana dla pilota i dla części bez modeli w W19-06. Dla prób na prawdziwych klientach bez modeli w W19-01 i W19-04 nie jest zapisana wprost. Najprościej dopisać jedno zdanie w proponowanej decyzji Gate 1: te próby też działają tylko w izolowanych profilach.
- **R19-P10:** wiersz 07 tabeli dowodów nie wymienia okna „nowy plugin + stary pin”. Ten przypadek jest jednak pokryty fixtures W19-01. Dopisanie jest opcjonalne.
- Literówki typograficzne w nowym tekście („od03”, „obecnie04”) są do poprawienia przy okazji.

### Ograniczenia, które nadal pozostają (wykonalność)
- Nie wiadomo jeszcze, czy oba klienty honorują `CODEX_HOME` / `CLAUDE_CONFIG_DIR` dla pluginów, cache'u i trust. Nie wiadomo też, czy logowanie subskrypcyjne zadziała w izolacji. Rozstrzygną to próby W19-01, a regułę stopu plan już ma.
- Jeśli profil zgodności legacy dla zestawów 0.6.x nie przejdzie kontroli, stary feature zatrzyma się, zamiast kontynuować. W takim przypadku AC-07 wymagałoby dowodu z W19-01 albo jawnego switch.
- Ponowne wczytanie instrukcji w tej samej sesji da się udowodnić dopiero w pilocie W19-06 (P08).
- Nie uruchamiałem testów, buildów, klientów ani modeli, bo plan nie zawiera kodu.

**Następny krok:** feature-decide przygotowuje proponowaną decyzję Gate 1 (cały zakres i pilot z izolacją, opcjonalnie z P09). Wykonanie nadal wymaga zgody użytkownika.


Nota koordynatora: pełny raport zachowany w prywatnym artefakcie, hash
`c6884875f41b58d9274601eeea55eb262d1cd51df53017c17879f36a41926cd5`.
P01/P02 independently verified; P09/P10 do rozliczenia przy propozycji Gate 1,
bez nowej pętli korekt lub kolejnego review. Cały produkt nadal niezaimplementowany.
