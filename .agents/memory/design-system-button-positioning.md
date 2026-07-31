---
name: Design-system button positioning quirk
description: hover-elevate styles force position:relative on buttons, silently breaking fixed/absolute positioning.
---

The staffing app's design system (index.css) applies `.hover-elevate:not(.no-default-hover-elevate) { position: relative; z-index: 0; }` to buttons. Its specificity beats Tailwind's `.fixed`/`.absolute`, so positioning classes on a Button silently do nothing (element renders in normal flow).

**Why:** Cost a debugging round when a floating bottom-right button rendered bottom-left in document flow.

**How to apply:** Never put `fixed`/`absolute` directly on a shadcn Button in this project — wrap it in a positioned `<div>` instead.
