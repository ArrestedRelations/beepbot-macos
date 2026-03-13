import { useEffect } from 'react';
import { useSkillsStore } from '../../stores/skills-store';
import { Sparkles } from 'lucide-react';

export function SkillsView() {
  const { skills, loading, fetchSkills } = useSkillsStore();

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  return (
    <div className="p-6 space-y-4">
      {loading && <p className="text-sm" style={{ color: 'var(--bb-text-muted)' }}>Loading...</p>}

      {skills.length === 0 && !loading && <p className="bb-empty">No skills found</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {skills.map((skill, i) => (
          <div key={skill.name} className={`bb-card bb-rise bb-stagger-${Math.min(i + 1, 11)}`}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bb-accent-subtle)' }}>
                <Sparkles size={14} style={{ color: 'var(--bb-accent)' }} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium font-mono" style={{ color: 'var(--bb-text-strong)' }}>{skill.name}</div>
                {skill.description && (
                  <p className="text-xs mt-1" style={{ color: 'var(--bb-text-muted)' }}>{skill.description}</p>
                )}
                <p className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--bb-text-faint)' }}>{skill.path}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
