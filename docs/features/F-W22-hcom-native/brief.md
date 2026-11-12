# F-W22-hcom-native — workflow przez hcom bez własnego MCP

Status: uzgodniony kierunek, brief do planowania, 2026-11-12.
Użytkownik zaakceptował kierunek i zlecił zapis jako kolejnego featura.
Obecny zakres pracy obejmuje dokumentację; nie jest zleceniem implementacji,
migracji projektów ani publikacji wydania.

## Cel

Bridge ma dostarczać workflow, skille i niewielkie helpery, a komunikację
koordynatora z wykonawcą zapewniać bezpośrednio przez hcom. Normalna instalacja,
wykonanie zadania i aktualizacja nie wymagają własnego serwera MCP Bridge,
jego managera, bazy ani przypiętego runtime'u.

Użytkownik może zaktualizować pakiet przy otwartych klientach Codex/Claude/ChatGPT.
Restart klienta jest wymagany tylko wtedy, gdy rzeczywiście potrzebuje go do
załadowania nowych skilli/pluginu. Samo pobranie i zachowanie nowego wydania
nie czeka na zamknięcie rozmów.

## Punkt wyjścia i zamierzona zmiana

- F-W21 wprowadził hcom jako jawnie wybierany transport. Obecny
  `feature-execute` w tym trybie nie używa MCP do prowadzenia rund, ale
  instalacja projektu nadal może uruchamiać MCP, a wybór instrukcji uwzględnia pin Bridge.
- Workflow 1.1.3 ma przypięte wydania, helpery hcom i obsługę startu wykonawcy.
  Wykorzystujemy istniejące elementy; nie budujemy nowego serwera ani schedulera.
- Aktualizator Bridge 0.8.2 sprawdza użycie starego runtime'u/projektu przez
  klientów. W obserwowanym przypadku współistnienie terminalowego serwera Codexa
  i serwera aplikacji ChatGPT prowadziło do `CLIENT_WORKSPACE_UNKNOWN`, a potem
  timeoutu. Kontrola używała socketu innego procesu i odrzucała niezgodny PID.
  Otwarte rozmowy stały się przeszkodą w aktualizacji pakietu.
- F-W22 zmienia domyślny model instalacji i wykonania. Wymaganie F-W21 zachowania
  dotychczasowej ścieżki Bridge nie oznacza obowiązku ładowania jej w nowym trybie.
  Historyczne kontrakty, wyniki prób i wydania pozostają zachowane.

## Wymagane zachowanie

1. **Domyślny hcom.** Nowy projekt działa bez konfiguracji własnego MCP Bridge.
   Zwykłe zlecenie wykonania uzgodnionego featura uruchamia istniejący workflow
   przez hcom; użytkownik nie potrzebuje specjalnego AGENTS.md, ręcznego launchera
   ani dodatkowego wyboru starego runtime'u. Zależności hcom i klientów są opisane
   i sprawdzane. Brak zależności daje konkretną diagnozę, bez automatycznego powrotu do MCP.
2. **Migracja istniejącego projektu.** Dostarczona procedura odłącza zarządzane
   wpisy starego MCP i zależność od jego runtime'u, zachowując obce ustawienia,
   historię, stan i możliwość rozpoznania dotychczasowej konfiguracji. Nie usuwa
   globalnie współdzielonych instalacji ani danych innych projektów. Nie przenosi
   po cichu aktywnego zadania Bridge do hcom. Wskazuje konkretną nierozliczoną
   pracę i sposób jej zakończenia, jeżeli uniemożliwia ona migrację.
3. **Wydania obok siebie.** Aktualizacja instaluje kompletne, zweryfikowane wydanie
   obok dotychczasowych. Trwający feature zachowuje wybraną wersję instrukcji
   i helperów; aktualizacja nie podmienia ich w miejscu i nie usuwa używanych kopii.
   Nowe feature'y mogą wybrać nowe wydanie po jego udostępnieniu klientowi.
4. **Aktualizacja bez skanowania rozmów.** Ścieżka bez MCP nie sprawdza writerów,
   cwd współdzielonego serwera, managera Bridge ani wszystkich sesji Codexa.
   Nie odmawia instalacji dlatego, że klient lub wykonawca pracuje. Ograniczenia
   pozostawione dla starej ścieżki dotyczą tylko operacji, które nadal tego wymagają.
5. **Instalacja i aktywacja są rozróżnione.** Wynik podaje osobno zainstalowane
   wydanie, wersję wybraną dla featura i ewentualny wymagany reload/restart klienta.
   Nie przedstawia restartu jako błędu instalacji ani instalacji jako dowodu
   załadowania nowych instrukcji. Nie obiecuje reloadu, którego klient nie obsługuje.
6. **Prosta obsługa.** Aktualizator i skill upgrade korzystają z trwałych zasobów
   wydania/pluginu, nie z generowanego osobno skryptu w Temp. Ten sam mechanizm
   działa w kolejnych projektach. Dokumentacja i instrukcje agentów nie nakazują
   już w nowym trybie wywołań `bridge_server_info` lub wznowienia managera.

## Kontrole, które pozostają

Zachowujemy identyfikację katalogu, featura, rundy i sesji wykonawcy, ochronę przed
ponownym wysłaniem niepewnego zlecenia, przegląd dostawy i jawny odbiór oraz
spójność wybranej wersji workflowu. Są to kontrole pracy, a nie globalna blokada
instalacji. Zachowujemy weryfikację integralności wydania i ochronę niezależnych
zmian konfiguracji. Nie wyłączamy zabezpieczeń starego runtime'u, kiedy nadal
obsługują rzeczywistą operację na jego stanie.

## Kryteria odbioru

| ID | Obserwowalny rezultat |
| --- | --- |
| AC-01 | W świeżym projekcie niezależny agent wykonuje uzgodniony feature przez hcom od zlecenia do odbioru bez uruchomienia/wywołania własnego MCP Bridge i bez specjalnych instrukcji w AGENTS.md. |
| AC-02 | Migracja istniejącego projektu odłącza zarządzany MCP i zależność runtime'u; zachowuje obce ustawienia, historyczne dane i inne projekty. Ponowienie zakończonej migracji nie powoduje dodatkowych zmian. |
| AC-03 | Aktywna lub nierozliczona praca starego Bridge nie jest gubiona ani automatycznie przepinana na hcom; procedura podaje konkretny stan i dalsze działanie. |
| AC-04 | Instalacja nowego wydania w trybie bez MCP kończy się przy otwartych klientach i pracującym hcom, bez skanowania natywnych writerów i bez wymuszonego zatrzymywania sesji. |
| AC-05 | Aktualizacja w trakcie zadania pozostawia jego identity, instrukcje i helpery bez zmian; nowe zadanie może użyć nowego wydania po aktywacji. |
| AC-06 | Wynik aktualizacji rozróżnia instalację od załadowania w kliencie i wskazuje restart tylko tam, gdzie wymagają go potwierdzone możliwości klienta. Jednorazowe odłączenie już działającego MCP może wymagać restartu. |
| AC-07 | Nadal wykrywane są zły katalog/sesja/runda, niepewne ponowienie wysyłki, uszkodzone wydanie oraz brak prawidłowego odbioru; kontrole te nie blokują samego dołożenia wydania. |
| AC-08 | Skill upgrade, instalacja, diagnostyka i dokumentacja prowadzą tę samą ścieżkę bez MCP w co najmniej dwóch projektach, bez skryptów pisanych doraźnie w Temp i bez żądania restartu współdzielonego serwera Codexa. |

Testy syntetyczne nie dowodzą AC-01 ani rzeczywistego reloadu klienta. Plan ma
oddzielić sprawdzenia bez modeli od ograniczonej próby użytkowej, z jawnym
budżetem i zaobserwowanymi wersjami klientów; ten brief nie uruchamia pilota.

## Poza zakresem

- Przepisywanie hcom, budowa kolejnego MCP, schedulera lub pełnej kopii dawnej
  maszyny stanów Bridge pod nową nazwą.
- Poszerzanie trybu hcom o równoległych workerów, multi-repo lub automatyczne
  odzyskiwanie po awariach tylko z powodu tej migracji.
- Bezwarunkowy hot reload wszystkich klientów i aktualizacja binariów hcom,
  Codexa lub Claude w trakcie ich pracy. To odrębne zależności i operacje.
- Kasowanie historycznych wydań, baz, dowodów prób, historii Git i not MIT.
- Usunięcie całego starego kodu jako warunek pierwszego działającego wydania;
  wycofany kod może pozostać poza domyślną instalacją, bez obciążania nowej ścieżki.

## Do rozstrzygnięcia podczas planowania

- Miejsca sprzężenia wyboru workflowu, instalatora, diagnostyki i wpisów pluginu
  z runtime'em MCP; dokładny zakres zmian w `docs/plugin-distribution.md`,
  `docs/features/README.md`, skillach upgrade/using-bridge i instrukcjach repo.
- Minimalna migracja konfiguracji i obsługa istniejących locków/feature'ów;
  sposób rozpoznania nierozliczonej starej pracy bez globalnego skanowania klientów.
- Rzeczywiste możliwości przeładowania pluginu/skilli w obsługiwanych klientach.
  Nie zakładamy, że instalacja oznacza odświeżenie bieżącej rozmowy.
- Czy stary tryb pozostaje osobno instalowanym wariantem przejściowym, czy jest
  wycofany z nowej dystrybucji. W obu przypadkach nie jest zależnością trybu hcom.

Następny krok: `$feature-plan F-W22-hcom-native`; bez implementacji.
