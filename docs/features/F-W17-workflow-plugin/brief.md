# F-W17-workflow-plugin — feature workflow jako osobny plugin

Status: brief do review planu, 2026-09-19. Implementacja niezlecona.
Źródło: użytkownik zlecił feature-design i feature-plan po omówieniu osobnego pluginu
workflow w tym samym repo i marketplace co bridge. Szczegóły techniczne pozostają
propozycją do review i decyzji, nie odebraną implementacją.

## Cel i zachowanie

Użytkownik instaluje feature-workflow z marketplace swojego klienta i może używać
feature-design, feature-plan, feature-execute, feature-review, feature-decide oraz
feature-exchange zarówno w Astrze (Codex), jak i w interaktywnym Claude Code.
Nie musi kopiować skilli do projektu ani instalować bridge'a, aby zaplanować,
wykonać lub zrecenzować feature samodzielnie.

Przykłady intencji: „Przejrzyj plan w docs/plans/example.md”, „Zaakceptuj ten plan”,
„Zaimplementuj feature opisany w briefie”. Jawne wskazanie konkretnego skilla też
pozostaje możliwe, z nazwą kwalifikowaną wymaganą przez danego klienta. Dostępność
pluginu sama nie stanowi zgody na delegowanie, publikację ani wykonanie planu.

W projekcie używającym bridge'a skille korzystają z instrukcji zgodnych z wybranym
runtime. Odświeżenie pluginu nie zmienia przypiętych reguł aktywnego featura.
Claude delegowany przez bridge otrzymuje instrukcje bez osobnej instalacji pluginu
workflow w jego osobistym profilu. Nadal możliwe jest jawne zlecenie pracy samodzielnej.

## Zakres i ograniczenia

- Jeden logiczny plugin feature-workflow, pakiety dla dwóch klientów, generowane
  ze wspólnych źródeł. To samo repo i obecny marketplace, z dwoma manifestami klientów.
- Bridge odpowiada za setup, komunikację i sesje; workflow za fazy pracy nad featurem.
- Współistnienie i migracja obecnego bridge-claude, który już zawiera feature-*.
- Wersja workflowu samodzielnego pochodzi z instalacji pluginu; wersja instrukcji
  pracy przez bridge pochodzi z pinu runtime. Zapis źródła w ledgerze przy istotnym
  wykonaniu/review, bez nowego rejestru każdej operacji.
- Zmiana źródła instrukcji, brak runtime lub konflikt nie mogą spowodować cichego
  przejścia do nowszego workflowu. Lokalny stan, konfiguracja i aktywne sesje chronione.
- Kanoniczne źródła pozostają w repo; wygenerowane kopie nie są ręcznie utrzymywane.
- Wdrażać na finalnym zintegrowanym wave16; nie przywracać obowiązkowych ZIP-ów.

Poza zakresem: osobne repo/marketplace, nowy runtime/backend lub task system,
publikacja do npm, automatyczna aktualizacja pinów, naprawa aktywnych sesji,
zmiana zachowania feature-* poza rozdzieleniem dystrybucji i wyborem instrukcji,
wykonywanie niezamówionych feature'ów oraz publikacja/wdrożenie tego planu.

## Kryteria odbioru

| ID | Zachowanie do potwierdzenia |
| --- | --- |
| AC-01 | Oba obecne manifesty marketplace oferują osobny plugin workflow; oba pakiety pochodzą ze wspólnego źródła w tym repo. |
| AC-02 | W czystym profilu każdego klienta dostępne są wszystkie sześć feature-* i ich zasoby; użycie samodzielne nie wymaga MCP, instalacji runtime ani konfiguracji projektu bridge'a. |
| AC-03 | Przy użyciu przez bridge źródłem instrukcji jest wybrany runtime; aktualizacja pluginu nie zmienia jego pinu ani treści. Brak/konflikt pinu nie jest ukrywany fallbackiem. |
| AC-04 | Zainstalowane oba pluginy i stare bridge-claude nie powodują niejawnego wyboru konkurujących instrukcji; istnieje sprawdzona migracja i jednoznaczne wywołanie. |
| AC-05 | Delegowany Claude otrzymuje właściwy workflow bez osobistej instalacji pluginu, również po rozdzieleniu pakietów. |
| AC-06 | Generowanie jest powtarzalne, odsyłacze i helper exchange działają poza checkoutem bridge'a; namespace i opcjonalna wymiana z wave16 pozostają zachowane. |
| AC-07 | Wykrywanie źródła jest odczytem: nie instaluje, nie inicjuje projektu, nie zajmuje managera i nie zmienia danych. Aktualizacja/usunięcie pluginu nie niszczy runtime ani dowodów. |
| AC-08 | README i instrukcja dystrybucji opisują instalację obu klientów, użycie samodzielne/przez bridge, migrację i ograniczenia; raport oddziela dowody hosta od zachowania modelu. |

## Otwarte ustalenia do lokalnego projektu kontraktu

Nazwy pakietów i kwalifikowanych komend, wykrywanie konfliktujących starych instalacji
oraz minimalny sposób udostępnienia instrukcji przypiętej wersji sprawdzić na klientach.
Nie zakładać automatycznego rozwiązywania zależności między pluginami. To lokalne
ustalenia W17-01, a nie pytania produktowe wymagające obecnie zatrzymania planowania.
Jeśli ograniczenie hosta uniemożliwi samodzielność lub zgodność z pinem, przedstawić
konkretny kompromis zamiast po cichu osłabić AC.
