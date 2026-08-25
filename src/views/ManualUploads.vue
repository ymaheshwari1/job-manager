<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
        </ion-buttons>
        <ion-title>{{ translate("Manual Uploads") }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main>


        <ion-searchbar :value="queryString" @ionInput="queryString = ($event as any).detail.value || ''" :placeholder="translate('Search uploads')"></ion-searchbar>

        <ion-segment class="feed-filter" :value="dataFeedFilter" @ionChange="dataFeedFilter = ($event as any).detail.value">
          <ion-segment-button value="all">
            <ion-label>{{ translate("All") }}</ion-label>
          </ion-segment-button>
          <ion-segment-button value="enabled">
            <ion-label>{{ translate("Data feed on") }}</ion-label>
          </ion-segment-button>
          <ion-segment-button value="disabled">
            <ion-label>{{ translate("Data feed off") }}</ion-label>
          </ion-segment-button>
        </ion-segment>

        <div class="empty-state" v-if="isLoading">
          <ion-item lines="none">
            <ion-spinner color="secondary" name="crescent" slot="start" />
            {{ translate("Fetching configs") }}
          </ion-item>
        </div>
        <div class="imports" v-else-if="importConfigs.length">
          <ion-card v-for="config in importConfigs" :key="config.configId">
            <ion-card-content>
              <ion-item lines="none">
                <ion-label>
                  <p class="overline">{{ config.configId }}</p>
                  {{ config.scriptTitle }}
                  <p>{{ config.description }}</p>
                </ion-label>
                <ion-badge slot="end" :color="isFeedOn(config) ? 'success' : 'medium'">
                  {{ isFeedOn(config) ? translate("Feed on") : translate("Feed off") }}
                </ion-badge>
              </ion-item>
              
              <ion-item lines="none">
                <ion-button slot="end" fill="clear" @click="startImport(config.configId)">
                  {{ translate("Start Import") }}
                  <ion-icon slot="end" :icon="arrowForwardOutline" />
                </ion-button>
              </ion-item>
            </ion-card-content>
          </ion-card>
        </div>
        <p class="empty-state" v-else>
          {{ translate("No configs found") }}
        </p>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IonSpinner, IonPage, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonCard, IonCardContent, IonIcon, IonButton, IonSearchbar, IonLabel, IonItem, IonBadge, IonSegment, IonSegmentButton, onIonViewWillEnter } from "@ionic/vue";
import { arrowForwardOutline } from "ionicons/icons";
import router from "@/router";
import { translate } from "@common";
import { useMdmConfigStore } from "@/store/mdmConfig";

const queryString = ref("");
const dataFeedFilter = ref("all");
const mdmStore = useMdmConfigStore();

// Mirrors the server-side isDataFeedEnabled() test: only an explicit "Y" counts as on, so the
// many pre-existing configs holding null read as off rather than as unknown.
const isFeedOn = (config: any) => config.enableDataFeed === "Y";

const configs = computed(() => mdmStore.getConfigs);
const isLoading = computed(() => mdmStore.getFetchStatus.configs === "pending");

const matchesFeedFilter = (config: any) => dataFeedFilter.value === "all" ||
  (dataFeedFilter.value === "enabled") === isFeedOn(config);

const importConfigs = computed(() => {
  const q = queryString.value.trim().toLowerCase();
  const matchesQuery = (config: any) => !q ||
    config.configId.toLowerCase().includes(q) ||
    config.scriptTitle?.toLowerCase().includes(q) ||
    config.description?.toLowerCase().includes(q);

  return configs.value.filter((config: any) => matchesFeedFilter(config) && matchesQuery(config));
});

onIonViewWillEnter(async () => {
  if (!mdmStore.getConfigs.length) {
    await mdmStore.fetchConfigs();
  }
});

const startImport = (typeId: string) => {
  router.push({ name: "ImportDetail", params: { type: typeId }});
};
</script>

<style scoped>


.feed-filter {
  margin-bottom: var(--spacer-xs);
}

.imports {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--spacer-xs);
  align-items: start;
}
</style>
