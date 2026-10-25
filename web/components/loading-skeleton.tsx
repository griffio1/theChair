import './loading-skeleton.css';

export function LoadingSkeleton({label='Loading',cards=1}:{label?:string;cards?:number}) {
  return <div className="loading-skeleton" role="status" aria-label={label} aria-busy="true">
    {Array.from({length:cards},(_,i)=><div className="loading-skeleton-card" aria-hidden="true" key={i}>
      <div className="skeleton-line skeleton-title"/><div className="skeleton-line"/>
      <div className="skeleton-line"/><div className="skeleton-line skeleton-short"/>
    </div>)}
  </div>;
}
