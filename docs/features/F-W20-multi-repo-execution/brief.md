# F-W20-multi-repo-execution — izolacja i dostawa featura w wielu repozytoriach

Status: uzgodniony kierunek, brief do planowania, 2026-11-05. Użytkownik zlecił zapis
ustaleń jako nowy feature. Brak zlecenia implementacji, merge, publikacji i migracji.

## Cel i przebieg użytkownika

Użytkownik definiuje feature, planuje go i wykonuje review w dowolnym checkoutcie
parent repo: na gałęzi głównej, gałęzi roboczej lub w worktree. Następnie merguje
przygotowaną dokumentację do gałęzi głównej parenta, tworzy nowy parent worktree
i zleca agentowi `feature-execute F-XXX`.

Dopiero `feature-execute` przygotowuje potrzebne izolowane checkouty repozytoriów
objętych zapisem, ich branche i powiązania zależności. Implementacja i generowanie
artefaktów nie zapisują przypadkiem do wspólnych checkoutów ani środowiska innego
featura. Dostawa i weryfikacja obejmują wszystkie zmienione repozytoria.

Rozszerzamy istniejący `feature-execute`; nie tworzymy nowego skilla wymaganego
w poleceniu. Zasady są generyczne: bez nazw produktów, katalogu `reference/`,
założenia o branchu `main` i zależności od konkretnego managera worktree.

## Potwierdzony punkt wyjścia

Przy bazie 417ddc2:

- `feature-execute` i wspólny przewodnik opisują osobne worktree przy delegowaniu
  i pracy równoległej, lecz nie określają przygotowania wszystkich zapisywalnych repo;
- sekcja „Bridge round executor” w `feature-execute` zastępuje resztę skilla, więc
  dopisek tylko w części koordynatora nie trafi automatycznie do wykonawcy;
- `references/bridge-loop.md` przekazuje scope i bazowy SHA rundy, a
  `references/local-delivery.md` odbiera pojedynczy zakres Git `BASE..HEAD`;
- zakresy i lease bridge’a nie są systemową izolacją procesów i nie gwarantują
  wykrycia dwóch różnych ścieżek do tego samego fizycznego checkoutu;
- obecny eksporter feature-exchange operuje na wskazanym repo; ignorowany child
  checkout nie staje się częścią ZIP-a parenta, a snapshot symlinka/submodule jest
  pomijany z adnotacją. Nie wolno obiecywać jego pełnej zawartości.

To feature workflow i sprawdzalnego odbioru. Twarde egzekwowanie fizycznych zakresów
przez runtime jest osobnym rozszerzeniem, którego ta dostawa nie może deklarować.

## Oczekiwane zachowanie

### Planowanie bez przygotowywania środowiska wykonania

1. Design/plan/review pozostają możliwe w dowolnym checkoutcie. Plan identyfikuje
   repozytoria, zależności, ograniczenia wersji i docelowe gałęzie integracyjne,
   ale nie wymaga przyszłych lokalnych ścieżek ani założenia worktree. Podczas
   planowania nie tworzymy ich tylko po to, by spełnić nową procedurę.
2. Nowy parent worktree z dokumentacją wystarcza do zlecenia wykonania. Lokalna
   nieobecność child repo jest zadaniem przygotowawczym execute, a nie powodem
   odsyłania użytkownika do ręcznego setupu lub ponownego planowania całości.
   Brak dostępu lub istotna niejasność wejściowej wersji może wymagać rozstrzygnięcia.

### Przygotowanie przez feature-execute

3. Przed implementacją i przed komendami mogącymi zapisywać do zależności agent
   rozpoznaje rzeczywisty parent worktree i repozytoria istotne dla zlecenia.
   Uwzględnia osobne repo zagnieżdżone i zewnętrzne, submodule, symlinki i lokalne
   zależności. Zwykłe katalogi monorepo nie stają się osobnymi repozytoriami.
4. Każde repo objęte zapisem ma odizolowany checkout przypisany do zadania.
   Domyślnie execute tworzy Git worktree; poprawny osobny klon też spełnia warunek.
   Już przygotowany checkout tego samego featura jest wykorzystywany po kontroli.
   Domyślna nazwa brancha odpowiada branchowi parenta, o ile reguły repo pozwalają.
   Przy kolizji z inną pracą agent wybiera jednoznaczną nazwę i zapisuje powiązanie;
   nie przejmuje, nie resetuje i nie przemianowuje cudzej gałęzi.
5. Izolacja wynika z rzeczywistych katalogów i własności zadania, nie z nazwy
   brancha ani testu `branch != main`. Gałąź integracyjną ustala się dla każdego
   repo oddzielnie. Execute sprawdza zgodność faktycznej bazy z uzgodnionymi
   wejściami; nie zmienia samowolnie pinów ani nie traktuje SHA z dawnego review
   jako identyfikacji bieżących, innych bajtów.
6. Agent sprawdza powiązania istotne dla uruchamianych komend, w tym lokalne
   pakiety, symlinki i generowane artefakty. Instalacja, build, test, hook lub
   codegen nie może zapisywać do współdzielonego checkoutu tylko dlatego, że kod
   źródłowy edytowany jest w poprawnym worktree. Zależność używana faktycznie
   tylko do odczytu może pozostać wspólna; nie trzeba klonować jej profilaktycznie.
   Wspólne metadane Git worktree i zwykłe cache narzędzi nie są same w sobie błędem.
7. Przygotowanie środowiska jest częścią zleconej implementacji w istniejącym
   zakresie. Agent wykonuje rutynowe kroki bez dodatkowej bramki zgody. Ochrona
   zastanych zmian, dostęp do repo i istotne decyzje poza zakresem nadal obowiązują.
   Wykrycie ryzyka zapisu w obcym lub wspólnym checkoutcie blokuje zależne zapisy,
   nie automatycznie wszystkie niezależne taski. Pozostałe defekty są rozliczane
   zbiorczo zgodnie ze stałymi preferencjami użytkownika.

### Własność, wznowienie i wykonawcy

8. W trybie bridge koordynator przygotowuje środowisko przed pierwszą rundą,
   której jest ono potrzebne. Kontrakt wymienia repozytoria, lokalizacje,
   faktyczne bazy, powiązania zależności i osobne zakresy zapisu. Wykonawca
   sprawdza ten kontekst, ale nie dodaje sam nieautoryzowanych repozytoriów.
   Te same reguły izolacji obowiązują w sekcji „Bridge round executor”.
9. Mapowanie repo → checkout → branch → baza → docelowa gałąź integracyjna
   oraz rzeczywiste zależności trafiają do istniejącego ledgera/kontraktu.
   Nie tworzymy drugiego lifecycle ani osobnego rejestru dublującego statusy tasków.
   Repozytoryjne dokumenty muszą być przenośne: absolutne ścieżki konkretnego hosta
   i dane prywatne pozostają w lokalnym checkpointcie, gdy nie powinny trafić do Git.
10. Wznowienie, compaction lub kolejne wywołanie execute weryfikuje i wykorzystuje
    istniejące środowisko. Zmiana ścieżek, brancha albo zależności wymaga ponownej
    odpowiedniej kontroli. Nie tworzymy kolejnych worktree i branchy dla tego samego
    zadania ani nie ponawiamy kosztownych audytów przed każdym wywołaniem narzędzia.
    Nie wymagamy osobnego managera ani serwera MCP dla każdego child repo.

### Dostawa, review i integracja

11. Każde zmienione repo dostarcza własny bazowy i końcowy SHA, commity, status
    drzewa i dowody. Odbiór sprawdza zakres każdego repo oraz wymagane testy
    połączonego rozwiązania. Sam czysty parent lub jego `BASE..HEAD` nie wystarcza.
    Niedokończone własne zmiany w child repo nie mogą zniknąć z raportu COMPLETE.
    Zachowujemy zgodny format MCP: `changed_scope` pozostaje tablicą, nie obiektem
    grupującym repozytoria. Konkretny format dodatkowych danych dostawy ustala plan.
12. Lokalna integracja przed odbiorem obejmuje zgodny zestaw dostarczonych wersji
    wszystkich zależności i konsumentów. Może być sprawdzona na branchach featura
    przed jakimkolwiek merge do gałęzi głównych. Nie powstaje domyślna nowa bramka
    ani wymóg merge/push tylko po to, by otrzymać techniczne review.
13. Gdy merge jest autoryzowany, koordynator uwzględnia wszystkie objęte nim repo
    i ich właściwe gałęzie docelowe. Integruje w kolejności zależności tam, gdzie
    jest to wymagane, aktualizuje przypięcia do rzeczywistych zintegrowanych SHA
    i zapisuje mapowanie dostawy na integrację. Sam merge parenta nie jest dowodem
    ukończenia merge całego zestawu. Częściowy merge po awarii pozostaje widoczny
    i możliwy do kontynuacji; nie obiecujemy atomowej transakcji między repozytoriami.
14. Merge, push i deployment zachowują istniejące granice uprawnień. Reguła nie
    zmienia się w zgodę na publikację wszystkich forków. Review i odbiór wskazują
    rzeczywiście sprawdzony zakres i zestaw wersji. Przy zewnętrznym ZIP-ie jawnie
    określa się pokrycie repozytoriów; nie pakuje automatycznie ignorowanych katalogów.

## Zakres zmian i wyłączenia

W zakresie: wspólne zasady, odwołania z feature-plan/execute/review, sekcja wykonawcy,
kontrakty rund, reguły lokalnej dostawy, dokumentacja użycia i testy scenariuszy.
Jedna kanoniczna procedura szczegółowa może powstać w references feature-execute;
planner wybierze minimalny podział, zamiast kopiować instrukcje do wszystkich skilli.

Nie zmieniamy nazw publicznych skilli. Poza zakresem: wdrożenie w rzeczywistych
projektach użytkownika, ich migracje i merge, automatyczne tworzenie parent worktree,
nowy manager repozytoriów, zmiana lifecycle Yumi, twardy sandbox/lease fizycznych repo
w runtime, automatyczne sprzątanie worktree i nowy uniwersalny format archiwum wielu
repozytoriów. Brak takiego archiwum nie blokuje lokalnej dostawy przez Git.

## Kryteria odbioru

| ID | Obserwowalny wynik |
| --- | --- |
| AC-01 | Design/plan/review można ukończyć w dowolnym checkoutcie bez tworzenia środowiska child repo. Po przeniesieniu dokumentacji do nowego parent worktree zwykłe feature-execute rozpoczyna przygotowanie wykonania. |
| AC-02 | Dla child repo objętych zapisem execute tworzy potrzebne izolowane worktree/branche albo wykorzystuje poprawnie przygotowany klon/worktree tego samego zadania. Reguła nie zależy od nazwy gałęzi integracyjnej. |
| AC-03 | Kolizja nazwy brancha nie przejmuje cudzej pracy; zgodna nazwa alternatywna i powiązanie są zapisane. Zastane zmiany pozostają zachowane. |
| AC-04 | Ścieżka/symlink prowadzący do wspólnego checkoutu zostaje rozpoznany przed zapisem i zastąpiony właściwym powiązaniem w środowisku zadania albo powoduje blokadę zależnych zapisów. Zależność rzeczywiście tylko do odczytu może być wspólna. |
| AC-05 | Test izolacji obejmuje także zapis przez lokalny pakiet/build/codegen. Poprawny child worktree z zależnością zapisującą do wspólnego checkoutu nie jest błędnie uznany za gotowy. |
| AC-06 | Kontrakt bridge zawiera zweryfikowany kontekst wielu repo. Wykonawca rundy korzysta z tych reguł mimo zastąpienia pozostałej części skilla swoją sekcją. |
| AC-07 | Po wznowieniu nie powstaje drugi zestaw worktree/branchy; zmienione powiązanie zostaje ponownie sprawdzone. Wspólne metadane Git i normalny cache nie powodują fałszywej blokady. |
| AC-08 | Dostawa i review identyfikują BASE/HEAD, zakres zmian oraz dirt dla każdego zmienionego repo. Czysty parent nie maskuje niedokończonego child repo; wyniki integracji dotyczą właściwego zestawu wersji. |
| AC-09 | Po zgodzie na merge rozliczone są wszystkie objęte nim repo i piny. Brak zgody na merge nie blokuje lokalnej integracji/review; częściowa operacja nie jest raportowana jako pełne zakończenie. |
| AC-10 | Dokumentacja i scenariusze pokazują standardowe polecenie feature-execute, niezależne klony/worktree, brak child checkoutu na starcie, wznowienie i granice zewnętrznego przekazania. Brak dodatkowych pytań o rutynowe przygotowanie oraz utrata izolacji tylko blokuje dotknięty zakres. |

Do walidacji użyć małych syntetycznych repozytoriów, a nie danych produkcyjnych.
Oddzielić testy ewentualnych helperów, spójności paczek i instrukcji od dowodu,
że rzeczywisty agent wykonał preflight; jeśli taki pilot będzie potrzebny, jego
zakres/budżet wymaga ustalenia przed startem. Nie deklarować gwarancji runtime’u
na podstawie samego tekstu skilla.

## Zależności i kwestie do planowania

[F-W19](../F-W19-workflow-versioning/brief.md) rozdziela wydawanie workflow i silnika.
Na dzień briefu F-W19 ma tylko projekt wymagań; pobranie aktualnych referencji zdalnych
nie wykazało jego implementacji. F-W20 nie wymaga merytorycznie F-W19 do zmiany reguł,
ale bez niego dystrybucja nadal podlega obecnemu przypięciu skilli do runtime’u.
Wtedy potrzebne jest wydanie bridge’a i jawny upgrade projektów. Po F-W19 zgodna
zmiana samych instrukcji może być osobnym wydaniem workflow. Plan ma sprawdzić,
czy wybrana realizacja wymaga dodatkowych możliwości silnika, zamiast to zakładać.

Planner powinien ustalić minimalny mechanizm preflight i jego sprawdzania: instrukcje,
wykorzystanie istniejących narzędzi lub mały helper, jeżeli wnosi rzeczywistą niezawodność.
Ma również określić sposób wykrywania repo, rozstrzygania wersji wejściowych i gałęzi,
mapowania lokalnych ścieżek, przekazania dostawy wielu repo w obecnym kontrakcie,
a także obsługi submodule i konfiguracji lokalnych pakietów. Specyficzne wartości
projektu należą do jego AGENTS.md/designu, nie do generycznego workflow.

Nie ma dodatkowej decyzji produktowej blokującej planowanie. Następny krok:
`$feature-plan F-W20`.
