import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Stands in for a screen whose module has not been built yet, naming the module
 * that will fill it so the gap is obvious rather than looking like a bug.
 */
export function PlaceholderPage({
  title,
  description,
  module,
}: {
  title: string;
  description: string;
  module: string;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming in {module}</CardTitle>
          <CardDescription>
            Authentication and access control for this screen are already live — only the content is
            still to be built.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          You are seeing this page because your role has permission to open it.
        </CardContent>
      </Card>
    </div>
  );
}
