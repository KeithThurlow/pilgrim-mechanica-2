"""Small helpers for the Wildcat variant (proposed for hskit, see docs/mechs/rampart-wildcat/skill-notes.md)."""


def islands(bm):
    """Loose parts of a bmesh as lists of faces (each plate panel, brick or bolt is one)."""
    bm.faces.index_update()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, group = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            group.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(group)
    return out
