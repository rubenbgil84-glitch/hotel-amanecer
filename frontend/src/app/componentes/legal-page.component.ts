import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SiteContentService } from '../site-content.service';
import type { SiteSettingKey } from '../site-settings.model';

interface PolicyFields {
  title: SiteSettingKey;
  content: SiteSettingKey;
}

const policyFields: Record<string, PolicyFields> = {
  privacy: { title: 'privacy_policy_title', content: 'privacy_policy_content' },
  legal: { title: 'legal_notice_title', content: 'legal_notice_content' },
  cookies: { title: 'cookies_policy_title', content: 'cookies_policy_content' },
};

@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="legal-page wrap">
      <p class="eyebrow">{{ siteContent.settings().site_name }}</p>
      <h1>{{ title() }}</h1>
      <div class="legal-content">{{ content() }}</div>
      <p><a routerLink="/">Volver al inicio</a></p>
    </main>
  `,
  styleUrl: './legal-page.component.scss',
})
export class LegalPage {
  readonly siteContent = inject(SiteContentService);
  private readonly route = inject(ActivatedRoute);
  private readonly fields = policyFields[this.route.snapshot.data['policy'] as string];
  readonly title = computed(() => this.siteContent.settings()[this.fields.title]);
  readonly content = computed(() => this.siteContent.settings()[this.fields.content]);
}
