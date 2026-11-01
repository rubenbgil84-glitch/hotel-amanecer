import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteContentService } from '../../site-content.service';
import { parseAboutServices } from '../../site-settings.model';

@Component({
  selector: 'app-sobre-nosotros',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sobre-nosotros.component.html',
  styleUrl: './sobre-nosotros.component.scss',
})
export class SobreNosotros {
  private readonly siteContent = inject(SiteContentService);
  readonly settings = this.siteContent.settings;
  readonly services = computed(() => parseAboutServices(this.settings().about_services));}
