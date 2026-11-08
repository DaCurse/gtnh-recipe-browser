# Minecraft controls and catalogue labels

Action buttons use the actual Minecraft button sprites from the existing pinned
GTNH Shadow UI 5.47 pack. The source and licence are recorded in
`assets/source/machine-ui/shadow-ui-provenance.json`. Exact source widgets and
crop provenance are in `assets/source/machine-ui/buttons/`; the same
CC-BY-NC-SA-4.0 licence and attribution apply to these crops.

Reproduce from the verified pack:

```sh
npm run ui:buttons -- .export-work/shadow-ui-5.47/Shadow.UI.v5.47.zip
```

The generator checks the complete ZIP digest before reading
`assets/minecraft/textures/gui/widgets.png`. The disabled, normal and hovered
200×20 regions start at `(0,46)`, `(0,66)` and `(0,86)`. Cropping preserves the
original pixels; no recolouring is performed. CSS border images retain the
two-pixel native bevel as four CSS pixels while stretching the flat centre to
fit each label. All three tiny PNGs participate in the existing offline precache.

Text follows `dark_mode_utils.target.button_font` in the pack metadata:
enabled `#BFBFBF`, hovered `#EFC62F`, disabled `#888888`. Primary actions use a
restrained warm text accent and destructive actions use pale red when idle;
both adopt the pack's gold text and actual hover texture on hover or keyboard
focus. Selected navigation/toggle buttons retain the highlighted state.
Keyboard focus also has a visible outline. Disabled buttons keep their own
texture and text colour when the pointer crosses them.

`src/mc-controls.css` defines an explicit `mc-button` opt-in under the body
`mc-theme` class. This also covers dialogs rendered outside the app shell.
Item slots, machine icons, recipe widgets and small clear/close affordances keep
their dedicated rendering. Standard buttons use the existing Minecraft font at
18px, a 40px minimum desktop height and a 44px mobile touch target. Width follows
the text; grouped actions wrap between buttons rather than clipping labels or
splitting a label over multiple lines. Dataset status text remains compact.

Catalogue item names use the same Minecraft font at its native 9px grid, with a
one-pixel shadow and the existing single-line ellipsis. Full names remain in the
tooltips. The search input and explanatory prose retain their existing fonts.

Browser verification:

```sh
npm run test:mc-controls -- <app-url> <playwright-module> [screenshots]
```

This checks real normal/hover/focus/disabled states, unchanged button bounds on
hover, catalogue names, item-slot isolation, 320/390px layouts, modal action
labels, and recipe pagination. Existing landing and native machine tests cover
navigation, offline use and sticky-ruler layering.
