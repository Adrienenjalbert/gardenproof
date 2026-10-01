# Content eval report

Provider: **mock** · run 2026-09-30T07:51:15.187Z

- Rubric pass rate: **100%**
- Consent compliance: **100%**
- Premium feel (LLM judge, 1–5): not judged (mock mode)

| Case | Scenario | Assets | Score | Consent | Premium | Failed criteria |
|---|---|---|---|---|---|---|
| patio-putney-full-consent | 5-star testimonial, all consents given | 4 | 100% | ✓ | – | – |
| pond-wimbledon-no-response | homeowner has not responded yet (no testimonial, no consent flags) | 4 | 100% | ✓ | – | – |
| fencing-clapham-photos-refused | homeowner refused photo consent: no public assets at all | 0 | 100% | ✓ | – | – |
| planting-richmond-3-star | 3-star rating: testimonial must not be featured, no star claims | 4 | 100% | ✓ | – | – |
| garden-room-balham-area-only | photos + area consented, first name NOT consented | 4 | 100% | ✓ | – | – |
| porcelain-barnes-no-area | photos + first name consented, area NOT consented | 4 | 100% | ✓ | – | – |
| terrace-putney-quote-not-consented | photos, area and name consented, quote NOT consented: photos yes, no quote/rating/stars anywhere | 4 | 100% | ✓ | – | – |
| lawn-wandsworth-withdrawn | homeowner gave full consent, then withdrew it: nothing public at all | 0 | 100% | ✓ | – | – |
| pergola-clapham-flagged-photo | one after photo flagged 'needs blur' (house number) and not cleared: it must not appear anywhere | 4 | 100% | ✓ | – | – |
| garden-design-wimbledon-thin | no crew brief or voice note (thin input): short honest copy and a thin-input flag | 4 | 100% | ✓ | – | – |

## Sample output

### patio-putney-full-consent

**H1:** Indian sandstone patio and low curved retaining wall in Putney

**Summary:** An Indian sandstone patio with a low curved retaining wall and steps, built by Thorburn Landscapes for a Putney garden. The planting includes box balls and lavender. It replaced the old concrete slabs and cracked crazy paving.

**Hooks:** Patio specialist in Putney? · Looking for a patio specialist? · Indian sandstone patio, Putney · Before and after in Putney · Finished in two weeks

**Primary text:** An Indian sandstone patio with a low curved retaining wall and steps. Finished in Putney.

### pond-wimbledon-no-response

**H1:** Circular brick-edged pond and self-binding gravel terrace in South West London

**Summary:** A circular brick-edged pond with a self-binding gravel terrace, a solar fountain and a lawn, designed and built by Thorburn Landscapes for a garden in South West London. It replaced an overgrown back garden. About three weeks from start to finish.

**Hooks:** Looking for a garden design specialist? · Circular brick-edged pond, South West London · Finished in about three weeks · Circular brick-edged pond, finished

**Primary text:** A circular brick-edged pond with a self-binding gravel terrace and a solar fountain. Finished in South West London.

### planting-richmond-3-star

**H1:** Pleached hornbeam and yew hedge in Richmond

**Summary:** Pleached hornbeam with a yew hedge and borders, planted by Thorburn Landscapes for a Richmond garden. The planting includes pleached hornbeam, yew, ornamental grasses, alliums and salvias. Four days from start to finish.

**Hooks:** Planting scheme specialist in Richmond? · Looking for a planting scheme specialist? · Pleached hornbeam, Richmond · Before and after in Richmond · Finished in four days

**Primary text:** Pleached hornbeam with a yew hedge and borders. Finished in Richmond.

### garden-room-balham-area-only

**H1:** Cedar-clad garden room base and porcelain stepping stones in Balham

**Summary:** A cedar-clad garden room base with porcelain stepping stones and side borders, built by Thorburn Landscapes for a Balham garden. The planting includes Japanese maple and ferns. Two and a half weeks from start to finish.

**Hooks:** Garden structure specialist in Balham? · Looking for a garden structure specialist? · Cedar-clad garden room base, Balham · Cedar-clad garden room base, finished

**Primary text:** A cedar-clad garden room base with porcelain stepping stones and side borders. Finished in Balham.

### porcelain-barnes-no-area

**H1:** Large-format grey porcelain terrace and raised beds in South West London

**Summary:** A large-format grey porcelain terrace with raised beds and low-voltage outdoor lighting, built by Thorburn Landscapes for a garden in South West London. It replaced dated decking. About two weeks from start to finish.

**Hooks:** Patio specialist in South West London? · Looking for a patio specialist? · Finished in about two weeks · Large-format grey porcelain terrace, finished

**Primary text:** A large-format grey porcelain terrace with raised beds and low-voltage outdoor lighting. Finished in South West London.

### terrace-putney-quote-not-consented

**H1:** Patio and York stone terrace in Putney

**Summary:** A patio with a York stone terrace and a brick edging, built by Thorburn Landscapes for a Putney garden. The planting includes lavender and hydrangeas. Ten days from start to finish.

**Hooks:** Patio specialist in Putney? · Looking for a patio specialist? · Patio, Putney · Before and after in Putney · Finished in ten days

**Primary text:** A patio with a York stone terrace and a brick edging. Finished in Putney.

### pergola-clapham-flagged-photo

**H1:** Oak pergola and raised beds in Clapham

**Summary:** An oak pergola with raised beds, built by Thorburn Landscapes for a Clapham garden. The planting includes star jasmine and wisteria. About two weeks from start to finish.

**Hooks:** Garden structure specialist in Clapham? · Looking for a garden structure specialist? · Oak pergola, Clapham · Before and after in Clapham · Finished in about two weeks

**Primary text:** An oak pergola with raised beds. Finished in Clapham.

### garden-design-wimbledon-thin

**H1:** Garden design & build in South West London

**Summary:** Garden design & build in South West London by Thorburn Landscapes. The photos show the garden before work began and once it was finished.

**Hooks:** Looking for a garden design specialist? · Same garden, before and after · Garden design, finished · A finished South West London garden · Recently finished: garden design

**Primary text:** Garden design & build in South West London, finished by Thorburn Landscapes.

