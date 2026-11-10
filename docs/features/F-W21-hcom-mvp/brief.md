# F-W21-hcom-mvp — delegowanie przez hcom z minimalnym kontraktem

Status: uzgodniony kierunek, brief do planowania, 2026-11-10.
Użytkownik zlecił zapis nowego featura i wyraźnie zawęził MVP: ma pozwolić szybko
sprawdzić przepływ pracy, a dalsze mechanizmy mają odpowiadać na zaobserwowane problemy.
To zlecenie dokumentacyjne; implementacja, instalacja i pilot nie zostały rozpoczęte.

## Cel

Sprawdzić, czy hcom może zapewnić wygodne uruchamianie i komunikację między
koordynatorem a wykonawcą, przy zachowaniu użytecznej części kontraktów Bridge'a.
Użytkownik zleca pracę, koordynator przekazuje ją wykonawcy, odbiera wynik,
recenzuje go i kieruje poprawki do tej samej sesji.

Docelowo można wykorzystać istniejący rdzeń Bridge'a z adapterem hcom. MVP nie
wymaga jednak przeniesienia całego runtime'u, wszystkich walidatorów, bazy ani
maszyny stanów. Wybieramy najmniejsze rozwiązanie pozwalające przeprowadzić
rzeczywistą próbę i ustalić, co faktycznie przeszkadza. Nie budujemy drugiego
pełnego systemu koordynacji jako warunku rozpoczęcia eksperymentu.

## Punkt wyjścia i hipoteza

Research obejmował hcom v0.7.31, commit
`de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf`, oraz Bridge 0.8.2, wydanie
`bridge-v0.8.2`. Obejrzano kod i dokumentację; hcom nie był uruchamiany.

- [hcom README](https://github.com/aannoo/hcom/blob/de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf/README.md)
- [Integracje, w tym natywne resume/fork Codexa](https://github.com/aannoo/hcom/blob/de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf/src/integration_spec.rs)
- [Wiadomości i odpowiedzi](https://github.com/aannoo/hcom/blob/de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf/src/commands/send.rs)
- [Protokół Bridge](../../PROTOCOL.md), [rundy i odbiór](../../feature-workflow.md).

Hipoteza: prosty kontrakt, raport i jawna decyzja koordynatora wystarczą do
użytecznego cyklu pracy przez hcom bez pełnego zestawu ograniczeń Bridge'a.
Nie zakładamy z góry lepszej niezawodności, jakości kodu ani niższego kosztu.
Negatywny lub nierozstrzygnięty wynik poprawnie wykonanej próby jest użyteczny.

## MVP: jeden kompletny przepływ

1. Jeden koordynator i jeden wykonawca, lokalnie, jedno repo/worktree i jedno
   aktywne zadanie. Roboczo pierwsza para to Codex jako koordynator i Claude Code
   jako wykonawca, zgodnie z obecnym workflow. To domyślny zakres planowania,
   nie wymóg obsługi obu kierunków; planner sprawdzi najkrótszą działającą ścieżkę.
2. Koordynator przez hcom uruchamia lub wskazuje jednoznacznie sesję wykonawcy
   i wysyła odniesienie do krótkiego kontraktu. Hcom rzeczywiście przenosi zlecenie
   i powiadomienie o wyniku; ręczne kopiowanie odpowiedzi nie jest ścieżką docelową.
3. Wykonawca wykonuje małą zmianę z obserwowalnym wynikiem i zapisuje raport.
4. Koordynator sprawdza raport, rzeczywiste zmiany i uzgodnione sprawdzenie,
   a następnie przekazuje konkretną uwagę w kolejnej rundzie tej samej sesji.
5. Wykonawca poprawia wynik. Koordynator zapisuje odbiór albo powód dalszych
   poprawek/zatrzymania. Użytkownik dostaje zwięzłe podsumowanie i ograniczenia.

Minimum testu użytkowego to pierwsza dostawa i jedna runda poprawek. Nie oznacza
to limitu jednej korekty w produkcie; budżet samego pilota określa plan.

## Minimalne obwarowania

W MVP obowiązują tylko kontrole potrzebne, by rozumieć przebieg i nie pomylić pracy:

- **Krótki kontrakt:** identyfikator zadania i rundy, cel, katalog pracy,
  dozwolony zakres zmian oraz jednoznaczne kryterium/sprawdzenie wyniku.
  Sposób zapisu wybierze planner; zwykły plik może wystarczyć.
- **Jednoznaczny adresat:** zapisane powiązanie zadania z konkretną sesją
  wykonawcy. Korekta nie wybiera „najnowszej” sesji i nie uruchamia po cichu nowej.
- **Mały raport:** identyfikator zadania i rundy, wynik complete/partial/blocked,
  opis i odniesienie do rzeczywistych zmian (commit albo identyfikowalny diff),
  wykonane sprawdzenia i ich wyniki albo jawne „nie wykonano”, pozostałe problemy.
  Nie wymagamy pełnego schematu dostawy Bridge'a ani dodatkowego commita tylko
  dla spełnienia formatu MVP; zwykłe zasady repo nadal obowiązują.
- **Jawny odbiór:** idle, koniec procesu i wiadomość „gotowe” nie wystarczają.
  Koordynator ocenia aktualny raport i zmiany. Raport z innym ID/rundą lub brak
  raportu nie może zostać omyłkowo odebrany; wystarcza prosta kontrola lub checklista.
- **Kontrolowane przerwanie:** oczekiwanie ma limit lub jasną możliwość
  przerwania. Przy niejasnym stanie zachowujemy kontrakt, raport i znaną sesję,
  pokazujemy problem; nie ponawiamy automatycznie wykonania i nie tworzymy
  zastępczej sesji. Ręczna diagnoza jest dopuszczalna w MVP.

Minimalny zapis przebiegu ma pozwolić odtworzyć: co wysłano, do której sesji,
co odebrano, jaką uwagę przekazano i jaki był odbiór. Może korzystać z plików
kontraktu/raportu oraz historii hcom; nie wymaga nowej bazy, dashboardu ani
obszernego ledgera dla każdej wiadomości. Dane prywatne pozostają lokalne.

## Granice pierwszej wersji

W zakresie: cienka procedura lub adapter, instrukcje obu ról, prosty kontrakt
oraz raport, pętla pierwsza dostawa → review → poprawka → odbiór, mały pilot
z jawnym raportem tarcia i ograniczeń. Planner preferuje istniejące mechanizmy,
lecz nie uzależnia pilota od zgodności z całym protokołem MCP Bridge'a.

Poza MVP:

- wielu wykonawców, równoległe zadania, multi-repo i komunikacja między komputerami;
- pełna maszyna stanów, lease'y zakresów, takeover/epoch, pełna idempotencja,
  automatyczne odzyskiwanie po crashu i obsługa wszystkich wyścigów wiadomości;
- fork i restart/resume po zamknięciu klienta jako obowiązkowy scenariusz odbioru;
- formalna migracja baz, aktywnych zadań i projektów z obecnego Bridge'a;
- nowy scheduler, TUI, installer, system uprawnień czy szeroki benchmark modeli;
- zmiany hcom upstream i jednoczesna kontrola tej samej sesji przez dwa launchery.

Brak tych mechanizmów ma być opisanym ograniczeniem eksperymentalnego trybu,
nie automatycznym blockerem MVP. Dodanie obwarowania wymaga wskazania konkretnego
problemu w próbie i proporcjonalnego rozwiązania, a rozszerzenie zakresu — decyzji.
Nie osłabiamy przy tym istniejących zabezpieczeń zwykłego trybu Bridge. Kontrakt
zakresu jest instrukcją, nie systemowym sandboxem; odbiór nie dowodzi jakości modelu.

## Próba i dalsze decyzje

Plan opisze jedno niewielkie, reprezentatywne zadanie ze sprawdzalnym wynikiem,
na izolowanym materiale. Ustali wersje klientów i hcom, maksymalny czas/koszt prób
oraz regułę zatrzymania przed uruchomieniem modeli. Ta faza dokumentacyjna nie
uruchamia żadnego modelu ani nie zmienia osobistych konfiguracji.

Główna obserwacja: czy da się domknąć cykl bez ręcznego przenoszenia treści i
bez utraty tożsamości zadania/sesji. Zanotować liczbę oraz przyczyny interwencji,
przybliżony czas obsługi, brakujące informacje przy odbiorze i problemy z kanałem.
Pojedynczy przebieg nie uzasadnia twierdzeń o ogólnej przewadze lub niezawodności.

Próby deterministyczne mogą sprawdzić obsługę brakującego i obcego raportu.
Potwierdzenie zachowania agentów wymaga rzeczywistego cyklu; mock ani samo
uruchomienie procesów nie spełniają tego kryterium. Jeśli cykl nie działa,
raport rozdziela błąd kanału, instrukcji, modelu, środowiska i kontraktu.

Po próbie rekomendacja wybiera: używać w tym ograniczonym zakresie, poprawić
konkretny problem, pogłębić pomiar albo porzucić podejście. Nie powstaje z góry
backlog odtwarzający wszystkie funkcje Bridge'a. Pełny adapter zachowujący jego
rdzeń pozostaje wariantem zależnym od dowodów, nie wymaganiem pierwszej fali.

## Kryteria odbioru

| ID | Obserwowalny wynik |
| --- | --- |
| AC-01 | Jedna lokalna para agentów realizuje zlecenie przez hcom z krótkim kontraktem; koordynator odbiera wynik bez ręcznego kopiowania odpowiedzi użytkownika. |
| AC-02 | Kontrakt i raport zawierają minimalne informacje opisane wyżej. Koordynator może zidentyfikować zmiany i odróżnić wykonane sprawdzenia od deklaracji lub braku testu. |
| AC-03 | Co najmniej jedna uwaga review trafia do tej samej zapisanej sesji wykonawcy jako następna runda, a poprawiony wynik podlega jawnemu odbiorowi. |
| AC-04 | Idle bez raportu, raport dla innego zadania/rundy i przerwane oczekiwanie nie kończą się fałszywym odbiorem ani automatycznym uruchomieniem zastępczego wykonawcy. Wystarcza proste wykrycie i czytelny stan do ręcznej diagnozy. |
| AC-05 | Wynik pilota identyfikuje wersje i sprawdzony zakres, interwencje, rzeczywiste problemy oraz rekomendację. Dowody z modeli są oddzielone od testów atrap. |
| AC-06 | Eksperymentalny tryb nie wymaga wdrożenia odłożonych mechanizmów i nie zmienia działania dotychczasowego Bridge'a ani istniejących projektów. Instrukcja jasno podaje ograniczenia MVP. |

AC-01 i AC-03 opisują działający rezultat produktu. Negatywny eksperyment może
zakończyć falę badawczą z kompletnym raportem, ale nie jest dowodem ich spełnienia
ani automatycznym odbiorem całego featura.

## Do rozstrzygnięcia podczas planowania

- Najkrótsza realizacja: instrukcje i istniejące CLI, mały helper czy cienki adapter
  korzystający z fragmentów obecnego Bridge'a. Nie wybierać pełnej przebudowy z góry.
- W jaki sposób oba agenty odczytają ten sam kontrakt i raport oraz zachowają
  jednoznaczną sesję; które kontrole można zostawić koordynatorowi w MVP.
- Dobór pierwszej pary, zadania, wersji i budżetu pilota. Obsługa odwrotnego
  kierunku oraz resume po zamknięciu mogą być późniejszą próbą, jeśli będą potrzebne.
- Opcjonalny tryb hcom celowo proponuje odstępstwo od obecnej procedury rund
  opisanej w docs/features/README.md i docs/feature-workflow.md. Plan ma wskazać
  miejsce wyboru trybu i jego ograniczenia; nie zmienia domyślnego workflow.

Nie ma decyzji produktowej blokującej zapis briefu. Następny krok:
`$feature-plan` dla `docs/features/F-W21-hcom-mvp/brief.md`, z dokładnym planem
wyłącznie MVP i dalszym zakresem uzależnionym od wyników próby.

## Rozszerzenie uzgodnione 2026-11-10 — skill jako wejście

Decyzja05 rozszerza pierwotne MVP: użytkownik wywołuje feature-execute lub
feature-flow z poleceniem „przez hcom”. Koordynator sam prowadzi istniejącą pętlę
zadania/review/poprawek; użytkownik nie odsyła do osobnej instrukcji pilota ani
nie zarządza komendami CLI. Zachowujemy commity i ledger zwykłego feature-execute.
Wcześniejsza procedura i pilot pozostają historycznym dowodem wykonalności.

| ID | Dodatkowe kryterium |
| --- | --- |
| AC-07 | feature-execute i feature-flow rozpoznają jawny wybór hcom, zapisują go i zachowują przy wznowieniu; nie wywołują wtedy Bridge MCP do zarządzania rundami |
| AC-08 | Worker korzysta z tego samego wybranego wydania instrukcji, wykonuje ograniczoną rundę i dostarcza commity, ledger oraz raport; koordynator weryfikuje dostawę |
| AC-09 | Wznowienie koordynatora odczytuje istniejący kontrakt/stan/historię i nie wysyła zadania drugi raz; niejasny send lub zmieniona sesja wymagają diagnozy |
| AC-10 | Generowane paczki zawierają nowe zasoby; dotychczasowa ścieżka Bridge zachowuje zachowanie; rzeczywisty pilot rozpoczyna się od skilla, obejmuje poprawkę i ponowny odczyt stanu koordynatora |
