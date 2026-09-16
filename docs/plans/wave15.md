# Wave15 — intuicyjne zlecanie i kontynuacja pracy

Status: DRAFT, nie do wykonania. Zapisany 2026-09-16 na bazie `1cd1be7`.
Szczegóły i ostateczny zakres ustalimy dopiero po odbiorze oraz integracji wave13
(diagnostyka) i wave14 (pluginy, automatyczny setup worktree).
Ten draft nie zmienia ich zleceń i nie upoważnia do równoległej implementacji wave15.
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

## Robocze zachowanie do dopracowania

- Astra odczytuje wskazany dokument i ustala, czy zawiera opis featura, gotowy plan,
  korektę czy propozycję niezatwierdzonych zmian. Dobiera potrzebne etapy i instrukcje.
- Jawne zlecenie implementacji autoryzuje wykonanie opisanego zakresu, planowanie
  potrzebne do realizacji, testy, review i zwykłe poprawki. Brak specyfikacji nie jest
  zgodą na wymyślanie istotnych decyzji produktowych.
- Trwała preferencja projektu określa domyślne role: Astra koordynuje i recenzuje,
  Claude implementuje przez bridge. Forma i miejsce tej preferencji zależą od wave14.
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

## Kandydaci do zakresu — jeszcze nie zobowiązania

Po integracji wave13/14 zdecydować, co pozostaje brakującym elementem, a co już działa:

1. Naturalne wznowienie: „kontynuuj feature X” wykorzystuje trwały stan i właściwą
   sesję; bez wybierania najnowszego UUID. Przy niejednoznaczności jedno konkretne
   pytanie. Nie wznawia DONE ani nie obchodzi ograniczeń recovery.
2. Czytelny status/powiadomienia: użytkownik widzi pracę, oczekiwanie na jego decyzję,
   zakończenie lub błąd; diagnostyka wave13 jest źródłem szczegółów, nie kolejnym
   konkurencyjnym stanem. Kanał powiadomień i zakres wymagają wyboru.
3. Zgodność klientów: jawne wspierane wersje, test aktualizacji i czytelna reakcja
   na nieobsługiwany host. Nie rozluźniać guarda tożsamości dla wygody. Ocenić, czy
   potrzebna jest osobna praca utrzymaniowa zamiast włączenia jej do wave15.

Nie wdrażać wszystkich kandydatów wyłącznie dlatego, że znaleźli się w tym draftcie.
Priorytetem pozostaje krótkie, naturalne zlecenie bez znajomości mechaniki bridge’a.

## Co uzupełnimy po integracji wave13 i wave14

- Przypięta baza, rzeczywiście dostarczone możliwości pluginów, konfiguracji i diagnostyki.
- Jedno kanoniczne miejsce preferencji projektu oraz zgodność wersji skilli/runtime.
- Konkretne luki obecnych wyzwalaczy i instrukcji; najmniejsza zmiana usuwająca każdą lukę.
- Końcowy zakres oraz podział kandydatów na tę falę, istniejące zachowanie i późniejsze prace.
- Kryteria odbioru, testy bez modeli i ewentualny mały scenariusz z modelami z budżetem.
- Dokładne taski, raportowanie postępu i sposób integracji.

Nie zakładamy z góry nowego skilla, routera, hooka ani zmiany bridge’a. Najpierw sprawdzić,
czy wystarczy doprecyzowanie istniejących instrukcji i metadanych pluginu. Nie zastępować
problemu nadmiernych review kolejną rozbudowaną warstwą koordynacji.

## Robocze scenariusze do przyszłych kryteriów

- „Zaimplementuj feature z pliku” w projekcie z domyślną delegacją.
- Ten sam komunikat z gotowym planem vs niepełnym opisem wymagającym jednej decyzji.
- „Tylko review” i „zrób sam” nie uruchamiają domyślnej implementacji/delegacji.
- Powrót do istniejącego featura, waiting_user i kilka możliwych kontekstów.
- Zakończony task, potrzebna poprawka i techniczny PASS nie kończą przedwcześnie
  całego zlecenia; końcowa akceptacja użytkownika pozostaje odrębna.
- Nieobsługiwana wersja hosta lub brak pluginu nie prowadzi do cichego obejścia
  workflowu, nowej sesji zastępczej ani zmiany globalnego profilu.

To przykłady do dopracowania, nie deklaracja pełnej macierzy testów. Ocena instrukcji
na papierze i testy atrap nie dowodzą intuicyjnego zachowania prawdziwego modelu.

## Poza obecnym kierunkiem

Supervisor osieroconych procesów, wzbudzanie zamkniętej Astry, /goal, nowy system
zarządzania projektami i gwarancja całkowicie bezobsługowej pracy przy każdej awarii.
Nie zmieniać aktywnych worktree, zakresu wave13/14 ani przypiętych runtime.
