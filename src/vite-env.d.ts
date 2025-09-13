// src/vite-env.d.ts

/// <reference types="vite/client" />

// For ?raw imports
declare module '*.glsl?raw' {
  const content: string;
  export default content;
}

// Also declare regular .glsl imports if needed
declare module '*.glsl' {
  const content: string;
  export default content;
}

// For other raw imports you might use
declare module '*.frag?raw' {
  const content: string;
  export default content;
}

declare module '*.vert?raw' {
  const content: string;
  export default content;
}

// Generic ?raw for any file
declare module '*?raw' {
  const content: string;
  export default content;
}
