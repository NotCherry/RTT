# Timeline Number Input Research

## Question

Why can a timeline frame field jump or lose its value when the playhead slider
moves, and what is the simplest stable interaction model for inserting a
keyframe at a manually entered frame?

## Findings

- React treats an input with a `value` prop as controlled and says the backing
  state must be updated synchronously from the input's current value in
  `onChange`; otherwise React restores the supplied value. This explains why
  deriving the field directly from playhead state can overwrite user input when
  the scrubber causes a parent render. Source: [React input reference](https://react.dev/reference/react-dom/components/input#controlling-an-input-with-a-state-variable).
- The HTML standard defines the number state as a user-editable numeric control,
  with `input` and `change` events, and permits the empty string while editing.
  This supports storing the field as a string and validating/parsing it only at
  the insertion boundary. Source: [WHATWG HTML number state](https://html.spec.whatwg.org/multipage/input.html#number-state-%28type%3Dnumber%29).
- The HTML standard distinguishes the continuously fired `input` event from the
  `change` event that represents a committed value, and describes range sliders
  as emitting `input` while dragged. This supports keeping scrubber playhead
  state separate from an explicit frame insertion value. Source: [WHATWG HTML common event behaviors](https://html.spec.whatwg.org/multipage/input.html#common-event-behaviors).
- MDN documents that `min`, `max`, and `step` constrain number inputs and that
  invalid values should be handled as validation failures. A non-negative,
  whole-number frame field therefore needs `min="0"`, `step="1"`, and an
  explicit validation check before insertion. Source: [MDN `<input type="number">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number).

## Application Decision

Keep the frame number as local controlled string state in the timeline panel.
The scrubber changes only the playhead. The Insert action validates and rounds
the typed frame, then passes it to the app's `upsertFrameAtFrame` path. This
preserves the entered value during scrubbing and makes insertion deterministic.