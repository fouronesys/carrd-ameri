---
name: Scroll-to-end gates must handle no-overflow
description: A "must scroll to bottom" gate breaks when content fits without scrolling
---

# Scroll-to-end gates must handle the no-overflow case

If a UI requires the user to scroll a container to the bottom before enabling an action (e.g. "read the terms then accept"), relying only on an `onScroll` handler is a bug: when the content fits within the container (large screens, short content), no scroll event ever fires and the user is permanently locked out.

**How to apply:** on open (and on resize), check `scrollHeight <= clientHeight + threshold` and unlock immediately if true. Use a `requestAnimationFrame` after mount so the container is measured. Keep the `onScroll` handler for the overflow case.
