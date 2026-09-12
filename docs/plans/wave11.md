# Wave11 — analiza pętli review i uproszczenie workflow

Status: DO WYKONANIA. Osobny etap analityczny, możliwy równolegle z wave10.

## Cel

Na przykładzie wave7 i wave9 ustalić, kiedy działania Astry przestały przybliżać
odebranie featura: zbędne przekazania, ponowne review już zamkniętych spraw,
nieproporcjonalne zabezpieczenia, ceremonialne akceptacje i brak kroku wstecz.
Celem nie jest obniżenie jakości ani tolerowanie błędów Claude’a. Rzeczywiste
naruszenia wymagań mają być wykrywane i naprawiane. Liczba 16 dokumentów review
nie oznacza 16 zbędnych audytów; trzeba ocenić decyzje i efekty poszczególnych rund.

## Materiał i metoda

1. Przypiąć wersje wave7 (odebrany checkpoint 66e524f), wave9 (dostawa 41755c5,
   integracja fb9c843/status 4adb51d) i wersje skilli, które faktycznie obowiązywały.
   Czytać dokumenty historyczne przez git show; nie zmieniać pracujących worktree.
   Uzupełnić raportami koordynatora. Jeśli prywatne rozmowy są niezbędne, uzgodnić
   minimalny lokalny zakres odczytu; nie publikować transkryptów i nie zakładać,
   że brak zapisu jest dowodem braku pracy. Nie uruchamiać płatnego replay modeli.
2. Odtworzyć chronologię decyzji: cel rundy, finding, jego dowód i wymaganie,
   zlecona poprawka, rezultat, kolejny reviewer, pytanie do użytkownika i powód.
   Rozdzielić fazy kontrakt/implementacja/korekta/integracja od powtórzeń tego samego
   problemu. Odróżnić czas wykonawcy, oczekiwanie na człowieka i narzut koordynacji;
   brak pomiaru oznaczyć, nie zgadywać oszczędności minut lub tokenów.
3. Ocenić każde istotne przekazanie: konkretny defekt; brak dowodu; istotna decyzja;
   rzeczywisty problem integracyjny; powtórzenie; kosmetyka; spekulatywna ochrona;
   rozrost rozwiązania, któremu wystarczyłoby uproszczenie. Wskazać również review,
   które były wartościowe i muszą pozostać. Nie karać za samo znalezienie błędu.
4. Dla zbędnych rund zaproponować kontrfaktyczny krótszy przebieg: co manager mógł
   wiedzieć w TAMTYM momencie, jaki prostszy wariant był dostępny i jak nadal sprawdzić
   istotne ryzyko. Nie oceniać wyłącznie z wiedzą nabytą po zakończeniu.
5. Rozróżnić źródła tarcia: skille, swobodna decyzja managera, wymagania użytkownika,
   narzędzia i automatyczny przegląd uprawnień. Zmiana skilla nie znosi zewnętrznego
   ograniczenia uprawnień. Nie analizować tu technicznej przyczyny awarii bridge’a,
   chyba że tłumaczy konkretną decyzję lub niepotrzebne przekazanie.

## Hipotezy do sprawdzenia, nie gotowy werdykt

- Po trzecim review TEGO SAMEGO problemu/fazy potrzebny jest krótki krok wstecz:
  jakie kryterium użytkownika pozostaje niespełnione, czy wada jest wykazana,
  jaki jest skutek i czy prostsze rozwiązanie usunie klasę problemów?
- To sygnał do refleksji, nie twardy limit rund, nowy dokument ani pytanie do człowieka
  z automatu. Realny błąd nie staje się akceptowalny, bo skończył się licznik.
- Werdykt powinien rozdzielać blokery odbioru, uwagi nieblokujące i osobne zadania.
  Hipotetyczne ryzyko bez związku z wymaganiami nie powinno blokować bez końca.
- Jedno miejsce ustaleń z re-checkiem otwartych ID może zastąpić kolejne pełne raporty.
  Dodatkowy reviewer wymaga konkretnej wartości, nie samego faktu zakończenia rundy.
- Jeśli rozwiązanie staje się coraz bardziej złożone, Astra powinna rozważyć zmianę
  podejścia w ramach autoryzacji. Materialną zmianę wymagań uzgadnia z użytkownikiem.
- Lokalna poprawka zgodna z zakresem nie wymaga ponownego pytania o zgodę. Odbiór
  użytkownika pozostaje odrębny od technicznego PASS.

## Wynik i ewentualna zmiana skilli

Najpierw raport z konkretnymi przykładami, odniesieniami do commitów i ograniczeniami
oraz mały zestaw zaleceń. Dla każdej proponowanej reguły wskazać problem, mechanizm
uproszczenia i ryzyko osłabienia review. Zaproponować dokładny diff właściwych skilli
oraz zmianę kolidujących instrukcji wspólnych, bez wdrażania go na aktywne sesje.
Zmiany skilli wdrożyć dopiero po akceptacji zaleceń w osobnym przeglądalnym commicie.

Walidacja reguł na historycznych/syntetycznych scenariuszach: istotny bug nadal blokuje,
brak krytycznego dowodu nie dostaje PASS, kosmetyczna uwaga nie zatrzymuje dostawy,
trzeci nawrót problemu prowadzi do oceny podejścia, a nie do kolejnej ceremonii,
nowy defekt nie ginie jako pozorne powtórzenie. Bez pisania testów powtarzających tekst
instrukcji. Nie obiecywać poprawy zachowania modelu bez późniejszego użycia w praktyce.

## Kryteria zakończenia

Raport rozlicza oba wave’y, wskazuje wartościowe i zbędne review oraz uproszczony
przebieg z zachowanymi wymaganiami. Zalecenia zaakceptowane lub jawnie odrzucone;
zatwierdzone zmiany skilli spójne i zweryfikowane scenariuszami. Osobno wskazany
plan obserwacji skuteczności w kolejnym rzeczywistym feature — bez uzależniania
zamknięcia analizy od nieograniczonego eksperymentu.

Postęp: wave11-progress.md; raport: wave11-report.md. Nie scalamy, nie wdrażamy,
nie zmieniamy produktu i nie akceptujemy cudzych feature’ów w ramach tej analizy.
