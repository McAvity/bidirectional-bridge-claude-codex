# F-W19-workflow-versioning — niezależne wersjonowanie workflow i bridge’a

Status: brief do planowania, 2026-10-28. Użytkownik zaakceptował kierunek
rozdzielenia wersji i zlecił feature-design. Zlecenie obejmuje zapis wymagań,
nie implementację, publikację ani aktualizację istniejących projektów.

## Cel

Użytkownik aktualizuje skille na komputerze przez istniejący marketplace i korzysta
z nich w kolejnych feature’ach bez podnoszenia wersji bridge’a w każdym projekcie.
Wersja silnika zmienia się tylko wtedy, gdy potrzebna jest zmiana jego funkcji lub
zgodności. Nowe instrukcje nie zmieniają po cichu zasad już rozpoczętej pracy.

Pozostają jedno repozytorium i jeden marketplace obsługujący oba klienty. Bridge
oraz feature-workflow mają niezależne numery i wydania. Astra i delegowany Claude
używają tego samego wybranego wydania workflow, niezależnie od własnych cache’ów
pluginów. Nadal można używać workflow samodzielnie, bez bridge’a.

## Stan obecny — potwierdzone źródła

Przy bazie bba155d (po wydaniu 0.6.1):

- `scripts/plugin-packages/generate.mjs` pobiera jedną wersję z głównego
  `package.json` dla pakietów bridge’a i workflow;
- `scripts/workflow-source/select-source.mjs` dla projektu z pinem wybiera
  instrukcje runtime’u zamiast nowszego pluginu użytkownika;
- `scripts/native-bridge-mcp.mjs` przekazuje wykonawcy pakiety `bridge-claude`
  i `feature-workflow-claude` pochodzące z tego runtime’u;
- `scripts/plugin-packages/release.json` wskazuje dokładny commit runtime’u;
- `.agents/skills/` jest kanonicznym źródłem skilli, a wygenerowane paczki obu
  klientów znajdują się w `plugins/`.

Dlatego aktualizacja pluginu na komputerze nie aktualizuje instrukcji przypiętego
projektu. Jest to dotychczasowa gwarancja spójności, którą zastępujemy osobnym
wyborem wersji workflow. Planner ma ustalić wszystkie zależności tych mechanizmów;
powyższe obserwacje nie przesądzają nowego schematu bazy ani formatu manifestów.

## Uzgodniony podział

| Element | Odpowiedzialność |
| --- | --- |
| Bridge | MCP, tożsamość i sesje, stan, delegacja/recovery, instalator oraz instrukcje techniczne związane z jego API. |
| Feature workflow | `feature-*`, wspólny przewodnik i zasoby/helpery konieczne do wykonania tego workflow; klientowe warianty pochodzą z jednego wydania. |

`using-bridge`, setup i upgrade muszą zachować zgodność z rzeczywistym runtime’em.
Dokładny podział wspólnych plików ustali planner. Nie wolno uzyskać niezależności
przez przypadkowe podmienianie technicznych reguł silnika nowym pluginem.

## Oczekiwane zachowanie

### Niezależne wydania i aktualizacja komputera

1. Zmiana wyłącznie workflow podnosi jego wersję, publikuje jego paczki dla Codexa
   i Claude Code oraz aktualizuje odpowiednie wpisy marketplace. Nie zmienia
   wersji, pina, zawartości ani identyfikatora wydanych paczek silnika.
2. Analogicznie wydanie silnika może pozostawić wydanie workflow bez zmian.
   Wspólne wydanie obu elementów jest możliwe, ale nie jest wymagane. Każde
   wydanie jest odtwarzalne z dokładnego źródła i zawartości; dotychczasowe tagi
   i historyczne paczki pozostają niezmienne. Osobne tagi, np. `bridge-v…`
   i `workflow-v…`, są rekomendacją; ich format ustala plan.
3. Użytkownik nadal aktualizuje plugin zwykłym CLI/marketplace danego klienta.
   Po wymaganym przez klienta przeładowaniu nowe feature’y wybierają aktywne
   zainstalowane wydanie workflow tego klienta. Nie wyszukują samowolnie nowszej
   wersji w sieci i nie wymagają edycji konfiguracji każdego projektu/worktree.
4. Aktualizacja pluginu tylko w kliencie koordynatora wystarcza do użycia wybranego
   workflow przez delegowanego Claude’a. Nie trzeba aktualizować jego osobistego
   pluginu. Niezależna interaktywna sesja Claude’a korzysta ze swojego zainstalowanego
   pluginu, dopóki nie prowadzi już featura z ustaloną wersją.

### Wersja przypisana do featura

5. Wybór następuje przy rozpoczęciu pracy nad featurem, także przed wykonaniem
   pierwszej rundy bridge’a — workflow obejmuje projektowanie i planowanie.
   System zachowuje dokładną tożsamość wydania i jego treść w trwałej lokalnej
   postaci niezależnej od cache’u marketplace. Nie tworzy równoległego lifecycle
   featura; planner określa zapis przed powstaniem indeksu i późniejsze powiązanie.
6. Kolejne fazy, rundy, review i wznowienia odwołują się do tego wyboru. Manager
   oraz wykonawca dostają zgodne instrukcje i zasoby z jednego wydania. Różnice
   opakowania/ścieżek dla klientów są dozwolone, mieszanie wersji reguł nie jest.
   Stare kopie skilli w paczce wykonawcy ani jego osobisty plugin nie przesłaniają
   wybranych instrukcji. Przy długiej natywnej sesji trzeba uwzględnić już załadowane
   instrukcje; sama zmiana katalogu `--plugin-dir` nie dowodzi ich przeładowania.
7. Aktualizacja, usunięcie cache’u lub wybór starszej wersji pluginu na komputerze
   nie modyfikuje rozpoczętego featura. Dwa worktree mogą równolegle prowadzić
   feature’y z różnymi wydaniami workflow i tym samym runtime’em.
8. Użytkownik może jawnie zmienić workflow istniejącego featura między rundami,
   po sprawdzeniu zgodności i rozliczeniu pracy w toku. Operacja pokazuje wersję
   obecną/docelową, zapisuje zmianę w historii i zachowuje feature, uprawnienia,
   zadania, decyzje i tożsamość sesji. Nie przerywa ani nie podmienia instrukcji
   aktywnego wykonawcy. Jeśli klient nie potrafi bezpiecznie przeładować instrukcji,
   wymaga jawnego restartu/wznowienia; nie udaje skutecznego przełączenia.

### Zgodność, wznowienie i przejście ze starego rozwiązania

9. Workflow deklaruje wymagania wobec silnika. Są sprawdzane przed zależną pracą,
   bez założenia, że identyczne numery oznaczają zgodność. Niezgodność wskazuje
   konkretny brak i potrzebną aktualizację. Nie uruchamia rundy, nie podnosi sama
   wersji silnika i nie wraca po cichu do innych instrukcji.
10. Jednorazowy upgrade silnika może być konieczny do wprowadzenia tej funkcji.
    Potem zgodne zmiany samych skilli nie wymagają zmian projektowego pina runtime’u,
    jego przebudowy ani konfiguracji kolejnych worktree. Projekt może nadal
    wymagać pierwszego setupu zgodnie z istniejącymi zasadami.
11. Istniejące feature’y zachowują dotychczasowe instrukcje i historię. Brak jawnego
    wyboru w starym stanie nie daje zgody na przypisanie najnowszego pluginu.
    Plan musi określić rozpoznanie starego zestawu, ewidencję jego pochodzenia
    i kontrolowane przejście; nie wolno edytować historii ani imitować zgody.
12. Wznowienie nie zgaduje wersji. Gdy dokładnego wydania brakuje albo jego zawartość
    nie zgadza się z identyfikatorem, system podaje sposób odzyskania i zatrzymuje
    zależne kroki. Praca offline działa, jeśli wymagane wydanie jest lokalnie zachowane.
    Nie obiecujemy synchronizacji stanu między komputerami.
13. Status/doctor oraz diagnostyka rozróżniają: silnik projektu, plugin zainstalowany
    w kliencie i workflow wybrany dla featura. Dane skonfigurowane nie są dowodem
    załadowania przez model. Odczyty diagnostyczne nie wybierają wersji ani nie
    przejmują featura; eksport zachowuje obecne ograniczenia prywatności.
14. W trybie samodzielnym aktualizacja workflow nie wymaga instalacji MCP/runtime’u.
    Reguły zgodności specyficzne dla bridge’a nie blokują takiej pracy. Ciągłość
    wersji rozpoczętego featura i jawne przejście pozostają czytelne także w tym trybie.

## Zakres i wyłączenia

W zakresie: wydawanie obu komponentów, dystrybucja klientowa, wybór i trwałość
instrukcji, przekazanie wykonawcy, zgodność, kontrolowane przejście oraz dokumentacja
instalacji/aktualizacji i dowody testowe. Skille pozostają w tym repo i marketplace.

Poza zakresem: osobny marketplace/repo, automatyczne masowe migracje projektów,
aktualizacje w trakcie aktywnej rundy, zastępcze sesje dla obejścia blokad,
synchronizacja baz między komputerami, scheduler agentów, zmiana bramek zgód,
nowe reguły wykonania feature’ów, publikacja npm i automatyczne sprzątanie historycznych
wydań. Nie przebudowujemy runtime’u obsługującego działającą sesję.

## Kryteria odbioru

| ID | Obserwowalny wynik |
| --- | --- |
| AC-01 | Można wydać poprawkę workflow i zainstalować ją w obu klientach bez zmiany wersji, pina i zawartości paczek silnika. Niezależne wydanie silnika również nie wymusza nowego wydania workflow. |
| AC-02 | Po aktualizacji pluginu i przeładowaniu klienta nowy feature w dwóch przygotowanych projektach wybiera nowy workflow przy niezmienionych runtime’ach, bez ręcznej aktualizacji konfiguracji projektów. |
| AC-03 | Feature rozpoczęty przed aktualizacją zachowuje dokładne instrukcje po aktualizacji/usunięciu cache’u i restarcie klienta. Nowy feature może równolegle używać nowego wydania. |
| AC-04 | Dowody rzeczywistego uruchomienia potwierdzają ten sam wybrany workflow u managera i delegowanego Claude’a, również gdy osobisty plugin wykonawcy jest starszy lub nieobecny. Historyczna kopia nie przesłania nowej. |
| AC-05 | Niezgodne wydanie daje konkretną diagnozę przed zależną pracą, bez rundy, zmiany runtime’u i cichego fallbacku. Zgodna poprawka instrukcji przechodzi na niezmienionym silniku. |
| AC-06 | Jawne przejście między wydaniami dla istniejącego featura zachowuje jego tożsamość i decyzje, jest odtwarzalne po przerwaniu i nie daje mieszanej wersji. Próba podczas aktywnej rundy nie zmienia jej instrukcji. |
| AC-07 | Stary feature po jednorazowym upgrade silnika zachowuje dotychczasowy workflow do jawnej zmiany. Sam odczyt/status ani brak nowego pola nie przypisuje najnowszego wydania. |
| AC-08 | Stan przed pierwszą rundą, po compaction i po wznowieniu identyfikuje właściwe wydanie. Brak/uszkodzenie pakietu jest wykrywane; zachowana kopia umożliwia pracę offline. |
| AC-09 | Status/diagnostyka rozróżniają wersje silnika, pluginu i featura oraz deklarację od obserwacji. Dokumentacja opisuje zwykły upgrade skilli, upgrade silnika i zmianę workflow trwającego featura. |
| AC-10 | Workflow działa i aktualizuje się bez bridge’a; obecny eksport/weryfikacja artefaktów i zasady prywatności pozostają zachowane. |

Plan powinien dobrać do kryteriów testy pakietów/zgodności, trwałego wyboru i recovery,
izolacji worktree oraz mały pilot klientów. Testy na atrapach lub same manifesty
nie mogą być przedstawiane jako dowód załadowania instrukcji przez rzeczywiste agenty.
Zakres i budżet pilota ustala się przed jego wykonaniem; ten brief go nie uruchamia.

## Do ustalenia przez feature-plan

- Granica zasobów workflow i instrukcji technicznych bridge’a oraz usunięcie
  niejednoznaczności z historycznymi kopiami w `bridge-claude`.
- Format manifestów wersji/zgodności, zapis wyboru przed wykonaniem oraz źródło
  wyboru przy wielu instalacjach pluginu. Preferencja domyślna: aktywne wydanie
  klienta koordynatora; bez zgadywania po czasie modyfikacji katalogu.
- Sposób zachowania obu wariantów klientowych i ich weryfikacji niezależnie od
  czyszczonego cache’u, w tym ścieżka odtworzenia dokładnej wersji.
- Możliwości przeładowania instrukcji w tej samej natywnej sesji i wymagany restart.
  To ryzyko wymagające dowodu, nie pretekst do tworzenia nowej sesji bez zgody.
- Reprezentacja przejścia historycznych feature’ów oraz zgodność starszych klientów
  z nowym stanem. Nazwy operacji i ewentualną migrację bazy wybiera plan.
- Proces publikacji i test, że wydanie workflow nie zmienia wydanych artefaktów silnika.

Brak dodatkowej decyzji produktowej blokującej planowanie. Powyższe kwestie są
zadaniami rozpoznania dla planera; jeżeli dowody wymuszą zmianę uzgodnionego
zachowania, należy przedstawić konkretny wybór użytkownikowi.

Następny krok: `$feature-plan F-W19`.
