# Review 03 — plan integracji hcom ze skillami

**PASS** dla rozszerzenia planu na d6263ede7c5ea223612573f321be19794558359b.
Nie stwierdzono wymaganych poprawek. Zakres odpowiada zgodzie05: użytkownik wybiera
hcom w feature-execute/feature-flow, a koordynator prowadzi rundy i odbiór.
W21-03 może rozpocząć implementację, potem W21-04 w zachowanym budżecie.
Zgoda05 obejmuje wykonanie; **nie ma ponownej Gate 1**. Gate 2 dotyczy dopiero
całego rozszerzonego wyniku. Historyczny PASS pierwotnego MVP nie zastępuje AC-07–10.

## Wejścia i zakres

Review planu, 2026-11-10. Wejścia: brief z AC-07–10, design §7, decyzja05,
W21-03/04 i feature.json w d6263ed; wcześniejsze wyniki/review zachowane.
Sprawdzono bieżące źródła feature-execute, feature-flow, bridge-loop,
using-bridge oraz mechanizmy scripts/workflow-source/ i generator pakietów.
Nowe instrukcje są produktem pod oceną, nie źródłem zasad tego review.

INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74

Reviewer nie implementował rozszerzenia. Nie uruchamiano hcom, modeli ani MCP.
Jedyny zapis tego etapu to niniejsze review; bez zmian produktu i commitów.

## Ocena

- **Wybór transportu i wznowienie:** trwałe execution.transport jest w istniejącym
  indeksie. Brak pola zachowuje dotychczasowe zachowanie; jawny hcom nie powoduje
  cichej migracji aktywnego Bridge ani fallbacku. Routing przed zarządzaniem rundami
  jest właściwy dla obu wejść. Prywatny namespace feature/worktree oraz kontrola
  sesji, katalogu i instrukcji wystarczają dla jednej pary i jednego taska.
- **Niepewny send:** zapis zamiaru przed wysłaniem, niezmienne kontrakty/receipt,
  odczyt historii i odmowa ślepego ponowienia spełniają AC-09 bez obietnicy
  exactly-once czy recovery po crashu. Testy obejmują właśnie stan niepewności,
  duplikat rundy i niezgodną tożsamość. Helper nie jest launcherem ani schedulerem.
- **Źródło instrukcji:** workflow.mjs resolve sprawdza lock, obecność/integralność
  bundle i zgodność projektu, a następnie zwraca zweryfikowany root/client_root
  oraz identity. Plan zachowuje tę kolejność. Jawny transport hcom nie uprawnia
  do pominięcia starego pinu/locka ani czytania nowych refs z osobistej instalacji.
  Stary wybrany zestaw bez hcom wymaga jawnej zmiany workflow; pilot nowego
  standalone feature na kandydacie nie migruje F-W21 ani projektów użytkownika.
- **Worker i dostawa:** wspólne minimum round-executor oraz istniejące
  local-delivery zachowują bounded scope, commity, ledger i odbiór przez
  koordynatora. Bridge zachowuje envelope/binding/local-v1. Hcom używa pliku
  raportu wskazującego dostawę Git i dokładnego wariantu Claude tego samego wydania.
  To proporcjonalna integracja, a nie kopiowanie całej maszyny stanów.
- **Pakiety:** generator kopiuje drzewa feature-* wraz z zasobami i rozdziela
  komponenty bridge/workflow. Niewydane1.1.0 jest właściwym sposobem zmiany
  tożsamości bez nadpisywania zarejestrowanego1.0.0. Plan obejmuje generację,
  równość źródeł i testy dystrybucji; nie wymaga release ani wpisu do registry.
- **Minimalny zakres ról:** istniejące using-bridge już respektuje jawną instrukcję
  użytkownika. Pozostawienie jego źródeł i pakietów byte-identical, z routingiem
  tylko w skillach workflow i guide, jest zgodnym wyborem implementacyjnym.
  Wzmianka „Guide/using-bridge uznają” nie wymaga zbędnej edycji obu komponentów.
  Nie jest potrzebna nowa bramka ani zmiana wymagań z tego powodu.
- **Pilot i budżet:** W21-04 zależy od bezmodelowej walidacji W21-03 i ma przejść
  od skilla przez commity/ledger/raport, ponowny odczyt stanu oraz korektę w tej
  samej sesji. Nie udaje awarii ani nie zwiększa pozostałego budżetu1/2 prób i2/4
  promptów; zachowuje domyślne zgody i niezmierzone koszty jako nieznane.

## Pokrycie i dalsza weryfikacja

| Kryterium | Zaplanowany dowód |
| --- | --- |
| AC-07 | Routing obu skilli, trwały wybór i test jego zachowania przy wznowieniu; brak mutacji Bridge dla rund hcom |
| AC-08 | Wspólny executor, kontrola wybranego bundle i odbioru Git; realne dostawy W21-04 |
| AC-09 | Testy odmów helpera oraz rzeczywisty ponowny odczyt stanu między send i odbiorem, bez drugiego send |
| AC-10 | Generacja/zgodność zasobów, regresja zwykłego Bridge, pilot od nowego skilla z korektą |

Pokrycie jest wystarczające do implementacji; żadne z nowych AC nie jest jeszcze
uznane za wykonane. W review dostawy trzeba sprawdzić konkretne instrukcje startu,
przekazanie zweryfikowanej tożsamości workerowi i dowody wznowienia, a nie tylko
deklaracje lub PASS helpera. Są to już wymagane wyniki planu, bez nowego zakresu.

`git diff --check d6263ed^..d6263ed`: PASS. Nie uruchamiano testów produktu dla
samego planu. Brak nowych findingów; wcześniejsze R01-N01/N02 pozostają resolved.
