# Project Specification: Interactive Blog Header

## Goal
Build a static website for Github Pages featuring a "really cool" custom header with physics-based JavaScript animations.

## Design Specifications
- **Interactive Ropes**:
    - Strands attached at two points (top-to-top or top-to-side).
    - Drooping arc (sagging) effect implemented by target length > anchor distance.
    - Physics-based movement using Verlet integration.
    - Interactive: Users can click and drag ("pull") on the ropes.
- **Web Corner**:
    - A stylized spider web in the top right corner.
    - Rings have drooping arcs for a realistic silk look.
    - Integrated with the rope network.
- **Interactive Spider**:
    - A spider entity that lives on the ropes/web.
    - Moves autonomously along the strands.
    - Interactive: User can grab the spider and "throw" it.
- **Visuals**:
    - "Less dark" theme (slate/grayish background).
    - Reduced header height (200px).
    - Line depth effect (glowing/shadowed silk threads).
    - Smooth animations and high responsiveness.
- **Inverse Kinematics**:
    - Spider legs must dynamically touch and stick to nearby ropes or web strands.

## Technical Architecture (Modular)
The project is structured into functional modules for better maintainability:
- **Root Directory**:
    - `index.html`: Main landing page.
    - `style.css`: Base blog styles.
    - `spec.md`: Project specification.
- **`header/` Directory**:
    - `header.css`: Interactive header specific styles.
    - `config.js`: Global configuration constants.
    - `physics.js`: Core physics engine components.
    - `entities.js`: High-level interactive entities.
    - `spider.js`: Spider behavioral logic and IK.
    - `main.js`: Animation loop and application entry point.

## Technology Stack
- **HTML5 Canvas**: For high-performance physics rendering.
- **Vanilla JavaScript (ES6 Modules)**: Physics engine and logic. Requires a **web server** (including static hosting like GitHub Pages) to run. Cannot be opened via `file://`.
- **Vanilla CSS**: Layout and styling.

## Progress Tracking
- [x] Initial design specification.
- [x] Base website structure.
- [x] Physics engine implementation.
- [x] Ropes and Web generation.
- [x] Spider behavior and interaction.
- [x] Modular refactor and code cleanup.
- [x] Organized file structure and CSS split.
