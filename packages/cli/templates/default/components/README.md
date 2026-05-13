# components/

Each `.tender` file in this directory is a component you can invoke from `content.md`.

Example wrapper component (`callout.tender`):

```
---
tag: aside
class: callout
params: [variant]
---

<style>
.callout { border-left: 3px solid #888; padding: 1em; }
.callout[data-variant="warning"] { border-left-color: #c33; }
</style>
```

Use it in `content.md`:

```
<callout variant="warning">

Watch your step.

</callout>
```

For the full format reference (block templates with `params`/`slots`, inline-only components, the `<palette>` block, etc.), see the [Tender user guide](https://github.com/joshajh/tender/blob/main/docs/user-guide.md). For a complete worked example, see [`packages/core/test/fixtures/open-circle-tags/`](https://github.com/joshajh/tender/tree/main/packages/core/test/fixtures/open-circle-tags) in the Tender repository.

This `README.md` is harmless to keep or delete.
