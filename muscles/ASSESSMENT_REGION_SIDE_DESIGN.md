# Assessment region and side selection

Agreed interaction:

1. Select the body region first.
2. Show a side selector only when the selected region has distinct, supported left and right assessment protocols.
3. Selecting a side must load the matching native protocol, coordinates, posture set, solver evidence, and report identity. It must never relabel or mirror a protocol from the opposite side.
4. In Assessment Context, display the selected side as derived, read-only information rather than as a one-option selector.
5. Trunk should be represented as both sides and head/neck as midline without an editable side selector.
6. A region with only one supported side, currently the hand, must clearly show that limitation and must not offer an unsupported side.
7. Allow the user to return and change region or side before movement testing. Changing protocol must clear protocol-specific safety answers, symptom context, movement responses, and report state while preserving only data that is safe to reuse, such as demographics and the privacy acknowledgment.

Reason: the current default right-arm protocol exposes a required Body side selector containing only Right. The value is technically consistent with that protocol, but the control is misleading. Left and right must remain separate native protocols wherever separate protocol evidence exists.
