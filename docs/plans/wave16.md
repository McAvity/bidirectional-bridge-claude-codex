# Wave16 — lokalna dostawa przez bridge i Git, opcjonalny feature-exchange

Status: PLAN, implementacja niezlecona. Zapisano 2026-09-19.
Baza: `3a3afdd` na feature-workflow (wydanie 0.3.1).
Postęp: [wave16-progress.md](wave16-progress.md).

## Cel i uzgodniony kierunek

Astra zleca task Claude'owi przez bridge i wskazuje `feature-execute` w roli
wykonawcy. Claude implementuje, testuje, zapisuje zmiany i zwraca wynik przez bridge.
Astra samodzielnie odbiera dostawę i recenzuje wskazane commity. Gdy oboje mają dostęp
do repozytorium i dostarczonych commitów, ZIP nie jest potrzebny ani po każdej rundzie,
ani do końcowego odbioru użytkownika.

`feature-exchange` pozostaje narzędziem eksportu/importu na potrzeby przekazania poza
wspólny dostęp do repo lub na wyraźne żądanie. Może to być zewnętrzne review, przekazanie
planu/dostawy, kontrolowane przyjęcie zwróconych dokumentów lub archiwum na życzenie.
Zewnętrzny reviewer mający dostęp do właściwego commita również nie potrzebuje ZIP-a.

Uprościć procedurę, zachowując kontrolę zakresu, pochodzenia wyniku, testów i decyzji.
Nie tworzyć nowego koordynatora, systemu pakietów ani obowiązkowej formułki użytkownika.

## Zweryfikowany stan obecny

- `feature-execute` już rozdziela managera i wykonawcę. Sekcja „Bridge round executor”
  zastępuje pozostałe instrukcje dla Claude'a w rundzie, lecz wymaga export/verify ZIP
  oraz prefiksu `PACKAGE=… SHA256=… PURPOSE=… RANGE=… LEDGER=…` w podsumowaniu.
- `feature-exchange` wymaga pakietu każdej zakończonej rundy w sekcji „Round packages”.
- `feature-execute/references/bridge-loop.md` i `feature-review` wymagają verify paczki
  przed review; pętla wymaga również końcowego eksportu przed odbiorem użytkownika.
- Bridge przechowuje taski/próby, wynik, wyniki weryfikacji i artefakty. Rejestr
  artefaktów ma hashe; nie interpretuje konwencji `PACKAGE=…` ani manifestu ZIP.
- Integralność ZIP-a nie jest review kodu. Przy lokalnej dostawie Git może wskazać
  dokładne bajty kodu, ale aktualny HEAD i brudne drzewo nie mogą zastąpić dostarczonego SHA.

Źródła do wykonania: `.agents/skills/feature-execute/`, `feature-exchange/`,
`feature-review/`, `docs/features/README.md`, obie role `using-bridge`,
`docs/feature-workflow.md` i generator `scripts/plugin-packages/generate.mjs`.
Porównać z `shared/protocol/src/types.ts`, `shared/control-plane/src/feature-workflow.ts`
i `artifact-registry.ts`. Generowane `plugins/**` aktualizować przez generator.

## Docelowy podział odpowiedzialności

| Rola / narzędzie | Odpowiedzialność |
| --- | --- |
| Astra | Wybór taska, kontrakt, odbiór wyniku, niezależne review, korekty, decyzje i dalsza praca |
| Claude + feature-execute | Wykonanie wyłącznie taska/kontraktu rundy, testy, scoped commit i ledger, wynik albo konkretna blokada |
| Bridge | Przekazanie kontraktu i wyniku, stan wykonania, sesja, próby, idempotencja i istniejące ograniczenia |
| Git | Dokładne rewizje dostawy i różnica zmian |
| feature-exchange | Opcjonalny przenośny eksport/import, kiedy dostęp do repo nie wystarcza lub użytkownik go żąda |

Nie zabraniać użycia `feature-execute` bez bridge'a. Rozdzielenie trybu samodzielnego,
koordynatora i wykonawcy ma być jednoznaczne, bez wymuszania dodatkowego skilla.
Claude nie prowadzi własnego workflowu managera ani nie zleca niezależnego review.
Astra może używać ogólnych reguł wykonania, ale tylko ona prowadzi pętlę bridge'a.

## Minimalny kontrakt lokalnej dostawy

Wykorzystać istniejący wynik bridge'a i jego pola/artefakty, bez zmiany publicznego
protokołu z góry. W15 zachowuje swój intent/replay; nie przebudowywać go w tej fali.
Przed implementacją spisać konkretne mapowanie poniższych informacji do istniejących
pól; nie pozostawiać agentom kilku konkurujących formatów.

- Identyfikacja taska/próby z bridge'a i odwołanie do kontraktu.
- Pełne SHA bazy ustalonej w kontrakcie i dostarczonego head; zakres nie może być
  wybierany przez wykonawcę tak, aby ukryć niepożądane zmiany.
- Ledger, wynik COMPLETE/PARTIAL, wykonane kontrole, ich wyniki i ograniczenia.
- Wyraźna informacja o niecommitowanych zmianach; nie przedstawiać ich jako części
  dostarczonego commita. Brak gotowego commita nie oznacza utraty całego postępu.

Astra sprawdza istnienie commitów, zgodność bazy z kontraktem, relację w grafie Git,
rzeczywisty diff i zakres zapisu, ledger oraz dowody testów. Czyta kod z dostarczonego
head. Jeśli aktualna integracja odbiega od tego SHA, opisuje różnicę oddzielnie;
nie przypisuje automatycznie cudzych commitów wykonawcy. Nie resetuje ani nie czyści
cudzej pracy w celu ułatwienia review. Gdy nie da się potwierdzić autorstwa/zakresu,
rozstrzyga konkretną niezgodność zamiast uznawać dostawę za PASS.

Review dostarczonego SHA i ewentualne testy aktualnej integracji mają jawnie wskazane
rewizje. Dane niewersjonowane wymagają trwałego artefaktu z integralnością, jeśli są
istotne dla oceny. Sam hash lub wskazanie pliku nie dowodzą poprawności wyniku testu.
Brak zmian kodu nie oznacza automatycznie błędu: diagnoza lub potwierdzenie braku
potrzeby zmiany może być poprawnym wynikiem odpowiednio sformułowanego taska.

## Zakres zmian i zgodność

1. Usunąć obowiązkowy ZIP lokalnej rundy z instrukcji wykonawcy, odbioru i review.
2. Zastąpić obowiązkowy końcowy ZIP krótkim handoffem: commity, wyniki, ograniczenia,
   review i następny krok. Rzeczywisty odbiór użytkownika pozostaje wymagany.
3. Zachować export/verify/inspect-return i namespace dla opcjonalnej wymiany.
   Nie usuwać helpera namespace: intent wave15 nadal z niego korzysta.
4. Uzgodnić zależne przykłady i instrukcje, tak aby nie przywracały obowiązku ZIP-a.
   Nie przepisywać historycznych ledgerów, raportów, paczek ani decyzji.
5. Zachować istniejące scope/lease, limity, waiting_user, strict resume i rozdzielenie
   COMPLETE, review PASS oraz akceptacji. Usunięcie archiwum nie usuwa review.
6. Nowe zasady obowiązują po jawnym wyborze nowego runtime. Nie zmieniać w locie
   kontraktów już otwartych rund wymagających ZIP. Historyczne dostawy są nadal czytelne.

Jeżeli istniejący format wyniku okaże się niewystarczający, wskazać konkretną lukę i
najmniejszą propozycję zmiany przed rozszerzeniem API. Nie dodawać mechanicznego
helpera tylko dla opakowania kilku poleceń Git; helper dopuszczalny przy wykazanej
potrzebie wspólnej, testowalnej kontroli. Cała maszyna stanów nie jest zakresem tej fali.

## Zadania po osobnym zleceniu wykonania

| Zadanie | Wynik | Zależność |
| --- | --- | --- |
| W16-01 | Krótki kontrakt lokalnej dostawy: pola wyniku, kontrole Git, drift i zgodność starych rund | Brak |
| W16-02 | Uproszczone kanoniczne skille i dokumentacja; wygenerowane pluginy, bez drugiego workflowu | W16-01 |
| W16-03 | Regresje istotnych kontroli i scenariusze instrukcji, raport oraz niezależne review zmienionego zakresu | W16-02 |

Nie tworzyć teraz aktywnego featura ani rekordów bridge'a. Przy wykonaniu użyć
istniejących `work-items/` i feature.json; jeden manager prowadzi integrację wspólnych
skilli. W16-01 jest lokalną bramką techniczną, nie wymaga automatycznej decyzji
użytkownika po tasku. Stosować step-back, zamiast dodawać kolejne ogólne review.

## Kryteria odbioru

| ID | Kryterium |
| --- | --- |
| AC-01 | Lokalny task wykonany przez Claude'a i odebrany przez Astrę nie wymaga exportu, ZIP-a, importu ani komendy verify archiwum |
| AC-02 | Dostawa jednoznacznie wskazuje kontrakt, bazę/head, ledger, kontrole i wynik; Astra potwierdza rzeczywisty zakres zmian przed review |
| AC-03 | Zły SHA/baza, wyjście poza scope, brudne drzewo lub późniejszy cudzy commit nie dają fałszywego PASS ani automatycznego przypisania cudzej zmiany Claude'owi |
| AC-04 | Review, poprawki i kontynuacja działają z istniejącymi stanami bridge'a; wykonawca nie przejmuje roli koordynatora |
| AC-05 | Końcowy odbiór featura nie wymaga ZIP-a; COMPLETE, review i rzeczywisty odbiór są nadal rozdzielone |
| AC-06 | Jawnie żądany eksport i zewnętrzna zwrotka nadal działają z kontrolą integralności/konfliktów; starych dowodów nie zmieniono |
| AC-07 | Intent/replay wave15 oraz namespace pozostają działające; usunięcie ZIP-a nie tworzy nowej drogi do zdublowania rundy |
| AC-08 | README, skille obu ról i wygenerowane pluginy opisują tę samą procedurę; istniejący tryb wykonania bez bridge'a zachowany |

## Walidacja i granice dowodów

Testy bez modeli: prawidłowa dostawa po commitach, błędna baza/head, zmiana poza scope,
lokalna niecommitowana praca, HEAD przesunięty po dostawie, PARTIAL i poprawka w tej
samej sesji, task bez zmian kodu, jawny eksport oraz inspect-return. Wykorzystać
istniejące testy zamiast powielać mechanikę bridge'a. Testować ewentualny helper na
rzeczywistych repo Git; sam test obecności tekstu w skillu nie dowodzi zachowania modelu.
Obowiązują kontrole z AGENTS oraz packages:check, linki dokumentacji i diff.

Smoke z prawdziwą parą Astra–Claude: zaproponować osobno mały task bez ZIP-a,
review dostarczonego SHA i dalszą korektę tylko jeśli jest uzasadniona. Nie uruchamiać
modeli na podstawie tego planu. Nie uznawać testów atrap za dowód realnego workflowu.
W15 smoke, jeśli nadal oczekuje, pozostaje odrębnym zobowiązaniem: nie zaliczać go
przez samą integrację wave16 ani nie zmieniać jego pinu/procedury po cichu.

Poza zakresem: przebudowa intent/replay, automatyczne wybudzanie, supervisor,
nowy backend artefaktów, zdalna synchronizacja repo, zmiana publicznego protokołu
bez osobnego rozstrzygnięcia, usunięcie feature-exchange i automatyczne wdrożenie.
