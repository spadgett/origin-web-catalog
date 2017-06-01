import * as angular from 'angular';
import * as _ from 'lodash';

export class OrderServiceController implements angular.IController {

  static $inject = ['$scope', '$filter', 'ProjectsService', 'DataService', 'BindingService', 'Logger', 'Constants'];

  public ctrl: any = this;
  public $scope: any;

  private $filter: any;
  private ProjectsService: any;
  private DataService: any;
  private BindingService: any;
  private Logger: any;
  private watches: any[] = [];
  private planStep: any;
  private configStep: any;
  private bindStep: any;
  private reviewStep: any;
  private selectedProjectWatch: any;
  private deploymentConfigs: any;
  private deployments: any;
  private replicationControllers: any;
  private replicaSets: any;
  private statefulSets: any;
  private hasDeploymentFilter: any;
  private hasDeploymentConfigFilter: any;
  private validityWatcher: any;

  constructor($scope: any, $filter: any, ProjectsService: any, DataService: any, BindingService: any, Logger: any, Constants: any) {
    this.$scope = $scope;
    this.$filter = $filter;
    this.ProjectsService = ProjectsService;
    this.DataService = DataService;
    this.BindingService = BindingService;
    this.Logger = Logger;
    this.hasDeploymentFilter = $filter('hasDeployment');
    this.hasDeploymentConfigFilter = $filter('hasDeploymentConfig');
    this.ctrl.showPodPresets = _.get(Constants, ['ENABLE_TECH_PREVIEW_FEATURE', 'pod_presets'], false);
  }

  public $onInit() {
    this.ctrl.iconClass = this.ctrl.serviceClass.iconClass || 'fa fa-cubes';
    this.ctrl.imageUrl = this.ctrl.serviceClass.imageUrl;
    this.ctrl.serviceName = this.ctrl.serviceClass.name;
    this.ctrl.description = this.ctrl.serviceClass.description;
    this.ctrl.longDescription = this.ctrl.serviceClass.longDescription;
    this.ctrl.plans = _.get(this, 'ctrl.serviceClass.resource.plans', []);
    this.ctrl.applications = [];
    this.ctrl.parameterData = {};
    this.ctrl.forms = {};

    // Preselect the first plan. If there's only one plan, skip the wizard step.
    this.ctrl.selectedPlan = _.first(this.ctrl.plans);
    this.ctrl.planIndex = 0;

    this.ctrl.appToBind = null;
    this.ctrl.configStepValid = true;

    this.planStep = {
      id: 'plans',
      label: 'Plans',
      view: 'order-service/order-service-plans.html',
      hidden: this.ctrl.plans.length < 2,
      allowed: true,
      valid: true,
      onShow: this.showPlan
    };
    this.configStep = {
      label: 'Configuration',
      id: 'configure',
      view: 'order-service/order-service-configure.html',
      hidden: false,
      allowed: true,
      valid: false,
      onShow: this.showConfig
    };
    this.bindStep = {
      label: 'Bind',
      id: 'bind',
      view: 'order-service/order-service-bind.html',
      hidden: false,
      allowed: false,
      valid: true,
      onShow: this.showBind
    };
    this.reviewStep = {
      label: 'Results',
      id: 'results',
      view: 'order-service/order-service-review.html',
      hidden: false,
      allowed: false,
      valid: true,
      prevEnabled: false,
      onShow: this.showResults
    };

    this.ctrl.steps = [this.planStep, this.configStep, this.bindStep, this.reviewStep];
    this.ctrl.nameTaken = false;
    this.ctrl.wizardReady = true;
    this.ctrl.wizardDone = false;

    // Set updating true initially so that the next button doesn't enable,
    // disable, then enable again immediately.  The onProjectUpdate callback
    // will set this back to false.
    this.ctrl.updating = true;
    this.selectedProjectWatch = this.$scope.$watch(
      () => {
        return this.ctrl.selectedProject;
      },
      this.onProjectUpdate
    );

    var humanizeKind = this.$filter('humanizeKind');
    this.ctrl.groupByKind = function(object: any) {
      return humanizeKind(object.kind);
    };
  }

  public clearValidityWatcher = () => {
    if (this.validityWatcher) {
      this.validityWatcher();
      this.validityWatcher = undefined;
    }
    this.ctrl.reviewStep.allowed = false;
  };

  public showPlan = () => {
    this.clearValidityWatcher();
    this.ctrl.nextTitle = "Next >";
  };

  public showConfig = () => {
    this.clearValidityWatcher();
    this.ctrl.nextTitle = 'Next >';
    this.reviewStep.allowed = this.bindStep.hidden && this.configStep.valid;

    this.validityWatcher = this.$scope.$watch("$ctrl.forms.orderConfigureForm.$valid", (isValid: any, lastValue: any) => {
      this.configStep.valid = isValid;
      this.bindStep.allowed = this.configStep.valid;
      this.reviewStep.allowed = this.bindStep.hidden && this.configStep.valid;
    });
  };

  public showBind = () => {
    this.clearValidityWatcher();
    this.ctrl.nextTitle = 'Create';
    this.reviewStep.allowed = this.bindStep.valid;

    this.validityWatcher = this.$scope.$watch("$ctrl.forms.bindForm.$valid", (isValid: any, lastValue: any) => {
      this.bindStep.valid = isValid;
      this.reviewStep.allowed = this.bindStep.valid;
    });
  };

  public showResults = () => {
    this.clearValidityWatcher();
    this.ctrl.nextTitle = "Close";
    this.ctrl.wizardDone = true;
    this.provisionService();
  };

  public selectPlan(plan: any) {
    this.ctrl.selectedPlan = plan;
    // Clear any previous parameter data since each plan has its own parameter schema.
    this.ctrl.parameterData = {};
  }

  public provisionService = () => {
    this.ctrl.inProgress = true;
    this.ctrl.orderComplete = false;
    this.ctrl.error = false;

    if (this.isNewProject()) {
      // the selectedProject is actually a newProject object
      let newProjName = this.ctrl.selectedProject.metadata.name;
      let newProjDisplayName = this.ctrl.selectedProject.metadata.annotations['new-display-name'];
      let newProjDesc = this.$filter('description')(this.ctrl.selectedProject);
      let projReqObj: any = {
        apiVersion: "v1",
        kind: "ProjectRequest",
        metadata: {
          name: newProjName
        },
        displayName: newProjDisplayName,
        description: newProjDesc
      };
      this.DataService
        .create('projectrequests', null, projReqObj, this.$scope)
        .then( (data: any) => {
          this.ctrl.projectDisplayName = newProjDisplayName || newProjName;
          this.createService();
        }, (result: any) => {
          var data = result.data || {};
          if (data.reason === 'AlreadyExists') {
            this.ctrl.nameTaken = true;
          } else {
            this.ctrl.error = data.message || 'An error occurred creating the project.';
          }
        });
    } else {
      this.ctrl.projectDisplayName = this.$filter('displayName')(this.ctrl.selectedProject);
      this.createService();
    }
  };

  public createService() {
    let serviceInstance = this.makeServiceInstance();
    let resource = {
      group: 'servicecatalog.k8s.io',
      resource: 'instances'
    };
    let context = {
      namespace: this.ctrl.selectedProject.metadata.name
    };
    this.DataService.create(resource, null, serviceInstance, context).then((data: any) => {
      this.ctrl.orderInProgress = true;
      this.watchResults(resource, data, context);
      this.ctrl.serviceInstanceName = _.get(data, 'metadata.name');
      if (this.ctrl.shouldBindToApp !== 'none') {
        this.bindService();
      }
    }, (e: any) => {
      this.ctrl.error = e;
    });
  }

  public bindService() {
    this.ctrl.bindInProgress = true;
    this.ctrl.bindError = false;
    var context = {
      namespace: _.get(this.ctrl.selectedProject, 'metadata.name')
    };
    this.BindingService.bindService(context, this.ctrl.serviceInstanceName, this.ctrl.appToBind).then((binding: any) => {
      this.ctrl.binding = binding;
      this.ctrl.bindInProgress = false;
      this.ctrl.bindComplete = true;
      this.ctrl.bindError = null;

      this.DataService.watchObject(this.BindingService.bindingResource, _.get(this.ctrl.binding, 'metadata.name'), context, (binding: any) => {
        this.ctrl.binding = binding;
      });
    }, (e: any) => {
      this.ctrl.bindInProgress = false;
      this.ctrl.bindComplete = true;
      this.ctrl.bindError = e;
    });
  }

  public $onDestroy() {
    this.DataService.unwatchAll(this.watches);
    this.selectedProjectWatch();
    this.clearValidityWatcher();
  }

  public closePanel() {
    if (angular.isFunction(this.ctrl.handleClose)) {
      this.ctrl.handleClose();
    }
  }

  private updateBindability() {
    this.bindStep.hidden = _.size(this.ctrl.applications) < 1;
    this.reviewStep.allowed = this.bindStep.hidden;

    if (this.bindStep.hidden) {
      this.ctrl.nextTitle = "Create";
    } else {
      this.ctrl.nextTitle = "Next >";
    }
  }

  private onProjectUpdate = () => {
    if (this.isNewProject()) {
      this.ctrl.applications = [];
      this.updateBindability();
    } else {
      this.ctrl.updating = true;
      this.ProjectsService.get(this.ctrl.selectedProject.metadata.name).then(_.spread((project: any, context: any) => {

        this.ctrl.shouldBindToApp = "none";
        this.ctrl.serviceToBind = this.ctrl.serviceClass;

        // Load all the "application" types
        this.DataService.list('deploymentconfigs', context).then((deploymentConfigData: any) => {
          this.deploymentConfigs = _.toArray(deploymentConfigData.by('metadata.name'));
          this.sortApplications();
        });
        this.DataService.list('replicationcontrollers', context).then((replicationControllerData: any) => {
          this.replicationControllers = _.reject(replicationControllerData.by('metadata.name'), this.hasDeploymentConfigFilter);
          this.sortApplications();
        });
        this.DataService.list({
          group: 'extensions',
          resource: 'deployments'
        }, context).then((deploymentData: any) => {
          this.deployments = _.toArray(deploymentData.by('metadata.name'));
          this.sortApplications();
        });
        this.DataService.list({
          group: 'extensions',
          resource: 'replicasets'
        }, context).then((replicaSetData: any) => {
          this.replicaSets = _.reject(replicaSetData.by('metadata.name'), this.hasDeploymentFilter);
          this.sortApplications();
        });
        this.DataService.list({
          group: 'apps',
          resource: 'statefulsets'
        }, context).then((statefulSetData: any) => {
          this.statefulSets = _.toArray(statefulSetData.by('metadata.name'));
          this.sortApplications();
        });
      }));
    }
  };

  private sortApplications () {
    // Don't waste time sorting on each data load, just sort when we have them all
    if (this.deploymentConfigs && this.deployments && this.replicationControllers && this.replicaSets && this.statefulSets) {
      var apiObjects = this.deploymentConfigs.concat(this.deployments)
        .concat(this.replicationControllers)
        .concat(this.replicaSets)
        .concat(this.statefulSets);
      this.ctrl.applications = _.sortByAll(apiObjects, ['metadata.name', 'kind']);
      this.ctrl.updating = false;
      this.updateBindability();
    }
  }

  private makeServiceInstance() {
    let serviceClassName = _.get(this, 'ctrl.serviceClass.resource.metadata.name');

    let serviceInstance = {
      kind: 'Instance',
      apiVersion: 'servicecatalog.k8s.io/v1alpha1',
      metadata: {
        namespace: this.ctrl.selectedProject.metadata.name,
        generateName: serviceClassName + '-'
       },
       spec: {
         serviceClassName: serviceClassName,
         planName: this.ctrl.selectedPlan.name,
         parameters: this.ctrl.parameterData
       }
    };

    return serviceInstance;
  }

  private isNewProject(): boolean {
    return !this.ctrl.selectedProject || !_.has(this.ctrl.selectedProject, 'metadata.uid');
  }

  private watchResults = (resource: any, data: any, context: any) => {
    this.watches.push(this.DataService.watchObject(resource, data.metadata.name, context, (instanceData: any, action: any) => {
      var conditions: any = _.get(instanceData, 'status.conditions');
      var readyCondition: any = _.find(conditions, {type: "Ready"});

      this.ctrl.orderComplete = readyCondition && readyCondition.status === 'True';
      this.ctrl.error = _.find(conditions, {type: "ProvisionFailed"});
    }));
  }
}
