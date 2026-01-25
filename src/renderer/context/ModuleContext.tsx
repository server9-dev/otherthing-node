import { createContext, useContext, useState, ReactNode } from 'react';

export interface SelectedModule {
  id: string;
  name: string;
  description: string;
  category: string;
  runtime: string;
  author: string;
  repo: string;
  requirements: {
    min_gpus?: number;
    min_cpu_cores?: number;
    min_memory_mb?: number;
    gpu_vram_mb?: number;
  };
  tools: string[];
  chain_uri: string;
}

interface ModuleContextType {
  selectedModule: SelectedModule | null;
  setSelectedModule: (module: SelectedModule | null) => void;
  clearModule: () => void;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [selectedModule, setSelectedModule] = useState<SelectedModule | null>(null);

  const clearModule = () => setSelectedModule(null);

  return (
    <ModuleContext.Provider value={{ selectedModule, setSelectedModule, clearModule }}>
      {children}
    </ModuleContext.Provider>
  );
}

export function useModule() {
  const context = useContext(ModuleContext);
  if (context === undefined) {
    throw new Error('useModule must be used within a ModuleProvider');
  }
  return context;
}
