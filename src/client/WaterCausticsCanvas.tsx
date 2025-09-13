import React, { useRef, useEffect } from 'react';
import { WaterCausticsShader } from './WaterCausticsShader';

interface WaterCausticsCanvasProps {
  className?: string;
  style?: React.CSSProperties;
}

export const WaterCausticsCanvas: React.FC<WaterCausticsCanvasProps> = ({ 
  className = '', 
  style = {} 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<WaterCausticsShader | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      shaderRef.current = new WaterCausticsShader(canvasRef.current);
      shaderRef.current.start();
    } catch (error) {
      console.error('Failed to initialize water caustics shader:', error);
    }

    return () => {
      if (shaderRef.current) {
        shaderRef.current.destroy();
        shaderRef.current = null;
      }
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        ...style
      }}
    />
  );
};