export type Role = 'admin' | 'incubator_lead' | 'mentor' | 'startup' | 'observer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Startup {
  id: string;
  name: string;
  description: string;
  innovationReadinessLevel: number;
  nextStep: string;
  documentsSigned: number;
  teamMembers: number;
}

export interface ModuleCardProps {
  title: string;
  description: string;
  route: string;
}
