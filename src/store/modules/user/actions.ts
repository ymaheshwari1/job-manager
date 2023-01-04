import { UserService } from '@/services/UserService'
import { ActionTree } from 'vuex'
import RootState from '@/store/RootState'
import UserState from './UserState'
import * as types from './mutation-types'
import { hasError, showToast } from '@/utils'
import { translate } from '@/i18n'
import { Settings } from 'luxon'
import { getServerPermissionsFromRules, prepareAppPermissions, resetPermissions, setPermissions } from '@/authorization'


const actions: ActionTree<UserState, RootState> = {

  /**
   *  Login user
   * @param param0 state context
   * @param param1 payload: object { username, password }
   * @returns Promise
   */
  async login ({ commit, dispatch }, { username, password }) {
    try {
      const resp = await UserService.login(username, password);
      // Further we will have only response having 2xx status
      // https://axios-http.com/docs/handling_errors
      // We haven't customized validateStatus method and default behaviour is for all status other than 2xx
      // TODO Check if we need to handle all 2xx status other than 200


      /* ---- Guard clauses starts here --- */
      // Know about Guard clauses here: https://learningactors.com/javascript-guard-clauses-how-you-can-refactor-conditional-logic/
      // https://medium.com/@scadge/if-statements-design-guard-clauses-might-be-all-you-need-67219a1a981a


      // If we have any error most possible reason is incorrect credentials.
      if (hasError(resp)) {
        showToast(translate('Sorry, your username or password is incorrect. Please try again.'));
        console.error("error", resp.data._ERROR_MESSAGE_);
        return Promise.reject(new Error(resp.data._ERROR_MESSAGE_));
      }

      const token = resp.data.token;

      // Getting the permissions list from server
      const permissionId = process.env.VUE_APP_PERMISSION_ID;
      // Prepare permissions list
      const serverPermissionsFromRules = getServerPermissionsFromRules();
      if (permissionId) serverPermissionsFromRules.push(permissionId);

      const serverPermissions = await UserService.getUserPermissions({
        permissionIds: serverPermissionsFromRules
      }, token);
      const appPermissions = prepareAppPermissions(serverPermissions);


      // Checking if the user has permission to access the app
      // If there is no configuration, the permission check is not enabled
      if (permissionId) {
        // As the token is not yet set in the state passing token headers explicitly
        // TODO Abstract this out, how token is handled should be part of the method not the callee
        const hasPermission = appPermissions.some((appPermissionId: any) => appPermissionId === permissionId );
        // If there are any errors or permission check fails do not allow user to login
        if (hasPermission) {
          const permissionError = 'You do not have permission to access the app.';
          showToast(translate(permissionError));
          console.error("error", permissionError);
          return Promise.reject(new Error(permissionError));
        }
      }

      /*  ---- Guard clauses ends here --- */

      setPermissions(appPermissions);
      commit(types.USER_TOKEN_CHANGED, { newToken: token })
      commit(types.USER_PERMISSIONS_UPDATED, appPermissions);
      dispatch('getProfile')
      // Handling case for warnings like password may expire in few days
      if (resp.data._EVENT_MESSAGE_ && resp.data._EVENT_MESSAGE_.startsWith("Alert:")) {
      // TODO Internationalise text
        showToast(translate(resp.data._EVENT_MESSAGE_));
      }

    } catch (err: any) {
      // If any of the API call in try block has status code other than 2xx it will be handled in common catch block.
      // TODO Check if handling of specific status codes is required.
      showToast(translate('Something went wrong'));
      console.error("error", err);
      return Promise.reject(new Error(err))
    }
  },

  /**
   * Logout user
   */
  async logout ({ commit, dispatch }) {
    // TODO add any other tasks if need
    dispatch('job/clearJobState', null, { root: true });
    commit(types.USER_END_SESSION)
    resetPermissions();
  },

  /**
   * Get User profile
   */
  async getProfile ({ commit, dispatch }) {
    const resp = await UserService.getProfile()
    if (resp.status === 200) {
      const payload = {
        "inputFields": {
          "storeName_op": "not-empty"
        },
        "fieldList": ["productStoreId", "storeName"],
        "entityName": "ProductStore",
        "distinct": "Y",
        "noConditionFind": "Y"
      }
      const userProfile = resp.data;

      const storeResp = await UserService.getEComStores(payload);
      if(storeResp.status === 200 && !hasError(storeResp) && storeResp.data.docs?.length > 0) {
        const stores = storeResp.data.docs;

        userProfile.stores = [
          ...(stores ? stores : []),
          {
            productStoreId: "",
            storeName: "None"
          }
        ]
      }
      const currentProductStoreId = resp.data?.stores[0].productStoreId;
      if (currentProductStoreId) {
        dispatch('getShopifyConfig', currentProductStoreId);
      }

      this.dispatch('util/getServiceStatusDesc')
      if (userProfile.userTimeZone) {
        Settings.defaultZone = userProfile.userTimeZone;
      }
      const stores = userProfile.stores
      const userPrefResponse =  await UserService.getUserPreference({
        'userPrefTypeId': 'SELECTED_BRAND'
      });
      if(userPrefResponse.status === 200 && !hasError(userPrefResponse)) {
        const userPrefStore = stores.find((store: any) => store.productStoreId === userPrefResponse.data.userPrefValue)
        commit(types.USER_CURRENT_ECOM_STORE_UPDATED, userPrefStore ? userPrefStore : stores ? stores[0]: {});
        commit(types.USER_INFO_UPDATED, userProfile);
      } else {
        commit(types.USER_CURRENT_ECOM_STORE_UPDATED, stores ? stores[0]: {});
        commit(types.USER_INFO_UPDATED, userProfile);
      }
    }
  },

  /**
   * update current eComStore information
   */
  async setEcomStore({ commit, dispatch }, payload) {
    dispatch('job/clearJobState', null, { root: true });
    let productStore = payload.productStore;
    if(!productStore) {
      productStore = this.state.user.current.stores.find((store: any) => store.productStoreId === payload.productStoreId);
    }
    commit(types.USER_CURRENT_ECOM_STORE_UPDATED, productStore);
    await dispatch('getShopifyConfig',  productStore.productStoreId);
    await UserService.setUserPreference({
      'userPrefTypeId': 'SELECTED_BRAND',
      'userPrefValue': productStore.productStoreId
    });
  },
  /**
   * Update user timeZone
   */
  async setUserTimeZone ( { state, commit }, payload) {
    const current: any = state.current;
    // if set the same timezone again, no API call should happen
    if(current.userTimeZone !== payload.tzId) {
      const resp = await UserService.setUserTimeZone(payload)
      if (resp.status === 200 && !hasError(resp)) {
        current.userTimeZone = payload.tzId;
        commit(types.USER_INFO_UPDATED, current);
        Settings.defaultZone = current.userTimeZone;
        showToast(translate("Time zone updated successfully"));
      }
    }
  },

  /**
   * Set User Instance Url
   */
  setUserInstanceUrl ({ commit }, payload){
    commit(types.USER_INSTANCE_URL_UPDATED, payload)
  },


  async getShopifyConfig({ commit }, productStoreId) {
    if (productStoreId) { 
      let resp;
      const payload = {
        "inputFields": {
          "productStoreId": productStoreId,
        },
        "entityName": "ShopifyShopAndConfig",
        "noConditionFind": "Y",
        "fieldList": ["shopifyConfigId", "name", "shopId"]
      }
      try {
        resp = await UserService.getShopifyConfig(payload);
        if (resp.status === 200 && !hasError(resp) && resp.data?.docs?.length > 0) {
          commit(types.USER_SHOPIFY_CONFIGS_UPDATED, resp.data.docs);
          commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, resp.data.docs[0]);
        } else {
          // TODO need to remove api call for fetching fetching shopifyConfig, currently kept it for backward compatibility.
          payload["entityName"] = 'ShopifyConfig';
          payload["fieldList"] = ["shopifyConfigId", "shopifyConfigName", 'shopId']
          resp = await UserService.getShopifyConfig(payload);
          if (resp.status === 200 && !hasError(resp) && resp.data?.docs?.length > 0) {
            commit(types.USER_SHOPIFY_CONFIGS_UPDATED, resp.data.docs);
            commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, resp.data.docs[0]);
          } else {
            console.error(resp);
            commit(types.USER_SHOPIFY_CONFIGS_UPDATED, []);
            commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, {});
          }
        }
      } catch (err) {
        console.error(err);
        commit(types.USER_SHOPIFY_CONFIGS_UPDATED, []);
        commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, {});
      }
    } else {
      commit(types.USER_SHOPIFY_CONFIGS_UPDATED, []);
      commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, {});
    }
  },

  /**
   * update current shopify config id
   */
  async setCurrentShopifyConfig({ commit, dispatch, state }, payload) {
    let shopifyConfig = payload.shopifyConfig;
    if(!shopifyConfig) {
      shopifyConfig = state.shopifyConfigs.find((configs: any) => configs.shopifyConfigId === payload.shopifyConfigId)
    }

    commit(types.USER_CURRENT_SHOPIFY_CONFIG_UPDATED, shopifyConfig ? shopifyConfig : {});
    dispatch('job/clearJobState', null, { root: true });
  },

  /**
   * Get user pinned jobs
   */

  async getPinnedJobs({ commit, state }) {
    let resp;
    const user = state?.current as any
    console.log("user", user);

    try{
      const params = {
        "inputFields": {
          "userLoginId": user?.userLoginId,
          "userSearchPrefTypeId": "PINNED_JOB"
        },
        "viewSize": 1,
        "filterByDate": "Y",
        "sortBy": "fromDate ASC",
        "fieldList": ["searchPrefId", "searchPrefValue"],
        "entityName": "UserAndSearchPreference",
        "distinct": "Y",
        "noConditionFind": "Y"
      }
      resp = await UserService.getPinnedJobs(params);
      if(resp.status === 200 && resp.data.docs?.length && !hasError(resp)) {
        let pinnedJobs = resp.data.docs[0];
        pinnedJobs = {
          id: pinnedJobs?.searchPrefId ? pinnedJobs?.searchPrefId : '',
          jobs: pinnedJobs?.searchPrefValue ? JSON.parse(pinnedJobs?.searchPrefValue) : []
        }

        const enumIds = pinnedJobs?.jobs;
        await this.dispatch('job/fetchJobDescription', enumIds);

        user.pinnedJobs = pinnedJobs
        commit(types.USER_INFO_UPDATED, user);

        return pinnedJobs;
      } else {
        user.pinnedJobs = []
        commit(types.USER_INFO_UPDATED, user);
      }
    } catch(error) {
      console.error(error);
    }
    return resp;
  },

  /**
   * Update user's pinned jobs
   */
  async updatePinnedJobs({ dispatch, state }, payload) {
    let resp;
    const pinnedJobPrefId = (state.current as any)['pinnedJobs']?.id;

    try{
      if (pinnedJobPrefId) {
        resp = await UserService.updatePinnedJobPref({
          'searchPrefId': pinnedJobPrefId,
          'searchPrefValue': JSON.stringify(payload?.pinnedJobs)
        });

        if(resp.status === 200 && !hasError(resp)) {
          await dispatch('getPinnedJobs')
        }
      } else {
        resp = await UserService.createPinnedJobPref({
          'searchPrefValue': JSON.stringify(payload?.pinnedJobs)
        });
        if(resp.status === 200 && !hasError(resp)) {
          if(resp.data?.searchPrefId) {
            const params = {
              "searchPrefId": resp.data?.searchPrefId,
              "userSearchPrefTypeId": "PINNED_JOB",
            }
            const pinnedJob = await UserService.associatePinnedJobPrefToUser(params);
            if(pinnedJob.status === 200 && !hasError(pinnedJob)) {
              await dispatch('getPinnedJobs')
            }
          }
        }
      }
    } catch(error) {
      console.error(error);
    }
    return resp;
  },
  /**
   * Get user pemissions
   */
  /* async getUserPermissions({ commit }) {
    let resp;
    // TODO Make it configurable from the environment variables.
    // Though this might not be an server specific configuration, 
    // we will be adding it to environment variable for easy configuration at app level
    const viewSize = 200;
    let appPermissions = [] as any;

    try {
      const params = {
        "viewIndex": 0,
        viewSize,
      }
      resp = await UserService.getUserPermissions(params);
      if(resp.status === 200 && resp.data.docs?.length && !hasError(resp)) {
        let serverPermissions = resp.data.docs.map((permission: any) => permission.permissionId);
        const total = resp.data.count;
        const remainingPermissions = total - serverPermissions.length;
        if (remainingPermissions > 0) {
          // We need to get all the remaining permissions
          const apiCallsNeeded = Math.floor(remainingPermissions / viewSize) + ( remainingPermissions % viewSize != 0 ? 1 : 0);
          const responses = await Promise.all([...Array(apiCallsNeeded).keys()].map(async (index: any) => {
            const response = await UserService.getUserPermissions({
              "viewIndex": index + 1,
              viewSize,
            });
            if(response.status === 200 && !hasError(response)){
              return Promise.resolve(response);
              } else {
              return Promise.reject(response);
              }
          }))
          const permissionResponses = {
            success: [],
            failed: []
          }
          responses.reduce((permissionResponses: any, permissionResponse: any) => {
            if (permissionResponse.status !== 200 || hasError(permissionResponse) || !permissionResponse.data?.docs) {
              permissionResponses.failed.push(permissionResponse);
            } else {
              permissionResponses.success.push(permissionResponse);
            }
            return permissionResponses;
          }, permissionResponses)

          serverPermissions = permissionResponses.success.reduce((serverPermissions: any, response: any) => {
            serverPermissions.push(...response.data.docs.map((permission: any) => permission.permissionId));
            return serverPermissions;
          }, serverPermissions)

          // If partial permissions are received and we still allow user to login, some of the functionality might not work related to the permissions missed.
          // Show toast to user intimiting about the failure
          // Allow user to login
          // TODO Implement Retry or improve experience with show in progress icon and allowing login only if all the data related to user profile is fetched.
          if (permissionResponses.failed.length > 0) showToast(translate("Something went wrong while getting complete user profile. Try login again for smoother experience."));
        }
        appPermissions = prepareAppPermissions(serverPermissions);
      }
      setPermissions(appPermissions);
      commit(types.USER_PERMISSIONS_UPDATED, appPermissions);
      return appPermissions;
    } catch(error: any) {
      console.error(error);
      showToast(translate("Something went wrong while getting complete user profile. Try login again for smoother experience."));
    }
    return resp;
  } */
}

export default actions;
