# F-W18-feature-closure — odrzucenie i anulowanie featura

Status: brief do planowania, 2026-10-20. Zlecono feature-design, bez implementacji.
Użytkownik wskazał potrzebę odrzucenia/anulowania featura lub wykonanej pracy
bez fałszywej akceptacji i zajmowania slotu bridge’a. Uzgodniony zakres pierwszej
wersji: zamykanie bez aktywnej rundy; zatrzymywanie wykonawcy pozostaje poza zakresem.
Pozostałe szczegóły poniżej są wymaganiami proponowanego briefu, a nie odbiorem kodu.

## Cel

Użytkownik może zakończyć niechciany kierunek prac, również po dostarczeniu kodu.
Astra zapisuje właściwy wynik i przyczynę, zamyka dalsze wykonanie tego featura
oraz zwalnia jego slot. W tym samym worktree można następnie zlecić inny feature
bez edycji SQLite, usuwania stanu, podstawiania sesji ani wywoływania akceptacji.
Odrzucona praca pozostaje dostępna jako historia; jej odrzucenie nie dowodzi,
że była technicznie błędna, ani że spełniła kryteria produktu.

## Punkt wyjścia i źródła

Odczyt kodu przy bazie eaa61fc potwierdził:

- `shared/control-plane/src/feature-workflow.ts`: istnieje końcowa akceptacja,
  ale brak obsługiwanej operacji odrzucenia lub anulowania featura;
- `shared/mcp-server-core/src/tools.ts`: `bridge_feature_accept` akceptuje wynik
  i zwalnia slot przez rejestr managera;
- `shared/control-plane/src/manager-registry.ts`: jeden aktywny feature zajmuje slot
  worktree i blokuje zajęcie go przez inny feature;
- dokumentacja workflow rozróżnia wynik wykonawcy, review i odbiór, ale brakuje
  kompletnej ścieżki zamknięcia bez akceptacji w trwałym stanie bridge’a.

To zaobserwowane ograniczenie obecnej implementacji. Planner powinien sprawdzić
wszystkie zależne operacje, recovery, schematy i reguły zgodności; sam ten opis
nie rozstrzyga formatu bazy ani nazwy nowego narzędzia.

## Znaczenie decyzji

| Intencja | Oczekiwany efekt |
| --- | --- |
| Odrzucenie featura/dostarczonej pracy (`rejected`) | Definitywne zakończenie tego featura bez odbioru produktu; bez zlecania dalszych poprawek. |
| Rezygnacja z dalszej realizacji (`cancelled`) | Zakończenie bez oceny jakości wyniku, także przed pierwszą rundą albo po częściowej realizacji. |
| Poprawki do dostawy (`REWORK`) | Feature pozostaje otwarty; poprawki mogą być kontynuowane w granicach istniejącej zgody. |
| Pauza albo oczekiwanie na odpowiedź | Nie jest odrzuceniem/anulowaniem i nie zamyka featura. |
| Akceptacja (`accepted`) | Zachowuje dotychczasowe znaczenie i wymagania; nie służy zwalnianiu slotu odrzuconej pracy. |

Słowo „odrzucam” w kontekście review pojedynczej dostawy nie może automatycznie
zakończyć całego featura, jeśli użytkownik oczekuje poprawek. Przy rzeczywiście
niejednoznacznej intencji Astra wyjaśnia tę różnicę; przy jasnej istniejącej decyzji
nie wymaga ponownego potwierdzenia. Techniczny FAIL lub PARTIAL wykonawcy sam
w sobie nie jest decyzją produktową o zamknięciu.

## Oczekiwane zachowanie

1. Koordynator rozpoznaje jednoznaczną decyzję użytkownika lub działa w ramach
   jawnie delegowanej decyzji. Zachowuje przyczynę i wskazanie źródła uprawnienia.
   Bridge rejestruje oświadczenie managera; nie poświadcza samodzielnie autorstwa
   człowieka. Dokumenty featura i stan bridge’a mają pokazywać zgodny wynik.
2. Zamykanie jest możliwe przed rozpoczęciem pracy, po dostawie czekającej na review,
   podczas oczekiwania na użytkownika oraz po zakończonej próbie z blokadą/błędem,
   o ile nie ma nadal aktywnej lub nierozliczonej pracy wykonawcy. Nie trzeba
   wznawiać taska tylko po to, by go zakończyć produktowo.
3. Zamknięcie i zwolnienie własnego slotu są odporne na przerwanie, restart,
   powtórzenie żądania i równoległe wywołania. Użytkownik nie zostaje z trwale
   zamkniętym featurem blokującym slot. Ponowienie starego zamknięcia nie zajmuje
   slotu ponownie i nie zwalnia slotu nowego featura.
4. Wynik zamknięcia jest trwały i czytelny w odczytach oraz diagnostyce: odrzucony
   albo anulowany, przyczyna, moment i źródło decyzji. Historia akceptacji, pytań,
   rund, prób i review pozostaje zachowana. Oczekujące pytanie nie blokuje nowego
   featura i nie daje możliwości ponownego otwarcia zamkniętego featura odpowiedzią.
5. Zamknięty feature nie przyjmuje nowych rund ani recovery. Odczyt, odświeżenie
   stanu, ponowne create czy późny wynik wcześniejszej operacji nie mogą go otworzyć
   ani zamienić w zaakceptowany. Przyszłe wykorzystanie zachowanej pracy wymaga
   osobnego zlecenia; ponowne otwieranie tego samego featura nie należy do v1.
6. Aktywna runda oznacza odmowę zamknięcia z konkretnym powodem. Sama utrata
   odpowiedzi, timeout klienta lub wygaśnięcie lease nie dowodzą, że wykonawca
   przestał pracować. Niejednoznaczny stan wymaga rozliczenia istniejącymi procedurami;
   operacja zamknięcia nie zabija procesów i nie omija nierozliczonej próby.
7. Zamknięcie respektuje tożsamość managera, własność, worktree i istniejące reguły
   wznowienia/przejęcia. Nie daje obcej sesji nowego sposobu przejęcia pracy.
8. Wyniki istniejących tasków i spełnienie kryteriów pozostają historycznie prawdziwe.
   Task koordynujący ma odzwierciedlać zakończenie bez realizacji produktu, bez
   fałszywego sukcesu; dokładne odwzorowanie na dostępny lifecycle ustali planner.

## Zachowanie kodu i dokumentów

Odrzucenie wykonanej pracy w tym feature oznacza decyzję o jej nieprzyjęciu, a nie
polecenie usunięcia jej z dysku. Bez dodatkowej zgody nie wykonujemy revert/reset/clean,
nie usuwamy branchy, worktree, plików niecommitowanych, baz, deploymentów ani paczek.
Nie nadpisujemy dawnych ledgerów i werdyktów review. Nie zamieniamy niezrealizowanych
zadań w DONE ani niespełnionych kryteriów w PASS. Nie przepisujemy decyzji accepted
na rejected/cancelled; cofnięcie wcześniejszego odbioru pozostaje poza v1.

## Zakres

- Obsługiwane zamknięcie featura bez akceptacji i bez aktywnego wykonawcy.
- Rozliczenie slotu, taska koordynującego, pytań i późniejszych prób mutacji.
- Bezpieczne zastosowanie do istniejących otwartych featurów zapisanych przez 0.4.3,
  po jawnej aktualizacji projektu; bez konieczności rozpoczęcia ich od nowa.
- Instrukcje koordynatora i skille podejmowania decyzji/wykonania/review, wspólny
  workflow, dokumentacja narzędzi i diagram cyklu życia — w niezbędnym zakresie.
- Zachowanie samodzielnego workflow bez bridge’a: zapis odrzucenia/anulowania
  w dokumentach bez wymogu instalowania MCP i bez fikcyjnego zwalniania slotu.
- Dystrybucja zmienionych instrukcji ze wspólnych źródeł; starszy runtime nie może
  być przedstawiany jako obsługujący nową operację tylko dzięki nowszemu skillowi.

Poza zakresem: zatrzymywanie aktywnego procesu, supervisor osieroconych prób,
automatyczny rollback kodu lub danych, wznowienie zamkniętego featura, zmiana
wyniku już zaakceptowanego featura, osobne terminalne odrzucanie każdej dostawy/taska,
nowy system zadań, automatyczny takeover i anulowanie innych featurów.
Publikacja wydania, aktualizacja realnych projektów i zamknięcie ich featurów są
oddzielnymi operacjami; ten brief nie zleca ich wykonania.

## Kryteria odbioru

| ID | Zachowanie do potwierdzenia |
| --- | --- |
| AC-01 | Dostarczony feature bez aktywnej rundy można zamknąć jako rejected; nie powstaje akceptacja ani deklaracja spełnienia kryteriów. |
| AC-02 | Feature bez aktywnej pracy można anulować przed pierwszą rundą, w waiting_user, po dostawie oraz po zakończonej blokadzie/błędzie; nie uruchamia to modelu. |
| AC-03 | Po zamknięciu można utworzyć i uruchomić inny feature w tym samym worktree. Odczyt zachowuje wynik, przyczynę i historię starego. |
| AC-04 | Restart, utrata odpowiedzi i identyczne ponowienie nie dublują skutków, nie zostawiają trwale zajętego slotu i nie naruszają nowego featura. Sprzeczne ponowienie odmawia bez zmiany pierwotnej decyzji. |
| AC-05 | Zamknięcie aktywnej lub nierozliczonej próby odmawia bez skutków. Wyścig zamknięcia z run/recovery nie dopuszcza aktywnego wykonawcy po skutecznym zamknięciu. |
| AC-06 | Nowe rundy, recovery, odpowiedzi na stare pytania, odświeżenie stanu i inne mutacje nie otwierają zamkniętego featura. Istniejąca akceptacja nie zmienia znaczenia. |
| AC-07 | Obcy manager i obcy worktree nie mogą zamknąć featura ani zwolnić jego slotu. Wszystkie dotychczasowe kontrole własności pozostają skuteczne. |
| AC-08 | Commity, pliki robocze, dane, paczki i historyczne wyniki tasków pozostają zachowane. Koordynator i dokumenty nie twierdzą, że produkt został ukończony/odebrany. |
| AC-09 | Istniejący otwarty feature z danych 0.4.3 da się zamknąć po wspieranej aktualizacji, bez ręcznych edycji bazy. Zgodność ze starszym runtime i granice rollbacku są jawnie opisane i sprawdzone. |
| AC-10 | Instrukcje rozróżniają odrzucenie/anulowanie całego featura, REWORK dostawy i pauzę. Jasna decyzja jest wystarczająca, a niejednoznaczne odrzucenie pojedynczej dostawy nie zamyka całego featura. |
| AC-11 | Dokumentacja opisuje ścieżkę od decyzji do zwolnienia slotu, zachowanie bez bridge’a oraz odmowę podczas aktywnej pracy; zmienione kopie dystrybucyjne odpowiadają źródłom. |

Weryfikacja ma używać syntetycznych scenariuszy i nie uruchamiać płatnych modeli
bez oddzielnego zlecenia. Test narzędzi nie jest dowodem zachowania rzeczywistych
modeli; ewentualny smoke należy opisać oddzielnie.

## Ustalenia dla planowania

Brak otwartej decyzji produktowej blokującej planowanie: użytkownik wybrał zamykanie
bez aktywnej rundy. Nazwy rejected/cancelled określają semantykę, nie narzucają
kolumn ani schematu. Wcześniej proponowane `bridge_feature_close` pozostaje kandydatem
nazwy, a nie zatwierdzonym kontraktem API.

Planner powinien zweryfikować minimalny kontrakt narzędzi i trwałego zapisu,
atomowość zwolnienia slotu, ochronę przed późnymi wynikami/recovery, sposób
rozliczenia koordynatora, serializację nowych wyników i wersjonowanie bazy/runtime.
Jeśli nie da się spełnić wymagań przy istniejących interfejsach, powinien wskazać
konkretny kompromis zamiast osłabiać je po cichu. Nie tworzyć drugiego rejestru
statusów ani obowiązkowej osobnej decyzji przy każdym odczycie/powtórzeniu.

Następny krok: `feature-plan` dla tego briefu; następnie review planu i decyzja
w sprawie wykonania. Nie utworzono tasków implementacyjnych ani feature.json.
