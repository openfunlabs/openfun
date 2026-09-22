# OpenFun

The author maintains the README and architecture documents; present research and proposals in chat.

## Architecture

- Keep the design small. Reuse what exists; add abstractions, dependencies, or services only to meet a current need. Explain why a simpler change is insufficient. Avoid speculative extensibility and unrelated refactoring.
- Before proposing architecture or technology choices, complete at least three distinct literature searches across Consensus MCP and arXiv: relevant methods, alternatives, and limitations or counterevidence. Never choose a design first and backfill citations.
- If Consensus MCP is missing, ask the user to install it. Report connection or quota failures; get approval before substituting another research source. arXiv can use MCP or its official search/API. Semantic Scholar may supplement both.
- Verify key papers, read relevant sections for technical claims, and cite links and publication status. Deduplicate papers and distinguish findings from engineering judgments. Report evidence gaps; failed or irrelevant searches do not satisfy the research requirement.
- Present 2–3 viable options with evidence, tradeoffs, and validation plans. Include keeping the current design or making a minimal change when viable. Do not invent options to meet the count.
- Wait for explicit approval of the chosen design and scope before changing architecture, including prototypes, dependencies, or configuration. Silence and general development permission are not approval.
- Implement only the approved scope and test it. New architectural decisions or material deviations require renewed research and approval. Routine work within an approved design does not.
